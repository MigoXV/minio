// SPDX-License-Identifier: AGPL-3.0-or-later
// Management routes extend the version-pinned Console without exposing its Admin API.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/minio/console/pkg/auth"
	"github.com/minio/madmin-go/v3"
	"github.com/minio/minio-go/v7"
)

var managementName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$`)
var managementBucket = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func managementJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func managementError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	message := "服务暂时不可用"
	var ae madmin.ErrorResponse
	var se minio.ErrorResponse
	switch {
	case errors.As(err, &ae):
		status, message = managementErrorCode(ae.Code)
	case errors.As(err, &se):
		status, message = managementErrorCode(se.Code)
	}
	managementJSON(w, status, map[string]string{"error": message})
}

func managementErrorCode(code string) (int, string) {
	switch code {
	case "AccessDenied", "AllAccessDisabled", "UnauthorizedAccess", "InvalidAccessKeyId":
		return http.StatusForbidden, "当前账户没有执行此操作的权限"
	case "NoSuchUser", "NoSuchGroup", "NoSuchBucket", "NoSuchPolicy", "NoSuchServiceAccount":
		return http.StatusNotFound, "资源不存在"
	case "InvalidArgument", "MalformedPolicy", "InvalidPolicyDocument", "InvalidBucketName":
		return http.StatusBadRequest, "输入内容无效"
	case "EntityAlreadyExists", "BucketAlreadyExists":
		return http.StatusConflict, "资源已存在"
	default:
		return http.StatusBadGateway, "服务拒绝了此操作（" + code + "）"
	}
}

func managementBody(r *http.Request, out interface{}) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 128<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	var extra interface{}
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func managementNameOK(name string) bool {
	return managementName.MatchString(name) && name != "." && name != ".."
}

func managementOriginOK(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || (r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin") {
		return false
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host && (u.Scheme == "https" || u.Scheme == "http")
}

type overviewDriveCapacity struct {
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}

type overviewDrive struct {
	Path     string                 `json:"path"`
	State    string                 `json:"state"`
	Capacity *overviewDriveCapacity `json:"capacity"`
}

type overviewNode struct {
	Endpoint string          `json:"endpoint"`
	Drives   []overviewDrive `json:"drives"`
}

func overviewStorageNodes(servers []madmin.ServerProperties) []overviewNode {
	nodes := make([]overviewNode, 0, len(servers))
	for _, server := range servers {
		if server.Endpoint == "" && len(server.Disks) == 0 {
			continue
		}
		node := overviewNode{
			Endpoint: server.Endpoint,
			Drives:   make([]overviewDrive, 0, len(server.Disks)),
		}
		for _, disk := range server.Disks {
			drive := overviewDrive{Path: disk.DrivePath, State: "unknown"}
			if drive.Path == "" {
				drive.Path = disk.Endpoint
				if strings.Contains(disk.Endpoint, "://") {
					drive.Path = ""
					if endpoint, err := url.Parse(disk.Endpoint); err == nil {
						drive.Path = endpoint.Path
					}
				}
			}
			switch disk.State {
			case madmin.DriveStateOk:
				drive.State = "online"
				if disk.TotalSpace > 0 && disk.UsedSpace <= disk.TotalSpace && disk.AvailableSpace == disk.TotalSpace-disk.UsedSpace {
					drive.Capacity = &overviewDriveCapacity{
						TotalBytes:     disk.TotalSpace,
						UsedBytes:      disk.UsedSpace,
						AvailableBytes: disk.AvailableSpace,
					}
				}
			case madmin.DriveStateOffline, madmin.DriveStateMissing:
				drive.State = "offline"
			case madmin.DriveStateCorrupt, madmin.DriveStatePermission, madmin.DriveStateFaulty, madmin.DriveStateRootMount, madmin.DriveStateUnformatted:
				drive.State = "abnormal"
			}
			node.Drives = append(node.Drives, drive)
		}
		sort.SliceStable(node.Drives, func(i, j int) bool { return node.Drives[i].Path < node.Drives[j].Path })
		nodes = append(nodes, node)
	}
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].Endpoint < nodes[j].Endpoint })
	return nodes
}

func newManagementHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/manage/") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodDelete {
			managementJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "不支持的请求方法"})
			return
		}
		if r.Method != http.MethodGet && !managementOriginOK(r) {
			managementJSON(w, http.StatusForbidden, map[string]string{"error": "请求来源未通过验证"})
			return
		}
		claims, err := auth.GetClaimsFromTokenInRequest(r)
		if err != nil || claims == nil || claims.STSAccessKeyID == "" {
			managementJSON(w, http.StatusUnauthorized, map[string]string{"error": "请重新登录"})
			return
		}
		admin, err := NewMinioAdminClient(r.Context(), claims)
		if err != nil {
			managementError(w, err)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/manage/"), "/")
		ctx := r.Context()
		switch parts[0] {
		case "me":
			if r.Method == http.MethodGet && len(parts) == 1 {
				managementJSON(w, 200, map[string]string{"account": claims.AccountAccessKey})
				return
			}
		case "overview":
			if r.Method == http.MethodGet && len(parts) == 1 {
				info, err := admin.ServerInfo(ctx)
				if err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 200, map[string]interface{}{
					"mode": info.Mode, "region": info.Region, "servers": len(info.Servers), "domain": info.Domain,
					"storageNodes": overviewStorageNodes(info.Servers),
				})
				return
			}
		case "users":
			if len(parts) == 1 && r.Method == http.MethodGet {
				users, err := admin.ListUsers(ctx)
				if err != nil {
					managementError(w, err)
					return
				}
				type row struct {
					Name   string               `json:"name"`
					Status madmin.AccountStatus `json:"status"`
					Policy string               `json:"policy"`
					Groups []string             `json:"groups"`
					Auth   *madmin.UserAuthInfo `json:"auth,omitempty"`
				}
				rows := make([]row, 0, len(users))
				for name, u := range users {
					rows = append(rows, row{name, u.Status, u.PolicyName, u.MemberOf, u.AuthInfo})
				}
				sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
				managementJSON(w, 200, rows)
				return
			}
			if len(parts) == 1 && r.Method == http.MethodPost {
				var input struct {
					Name     string `json:"name"`
					Password string `json:"password"`
				}
				if managementBody(r, &input) != nil || !managementNameOK(input.Name) || len(input.Password) < 8 {
					managementJSON(w, 400, map[string]string{"error": "用户名或密码无效（密码至少 8 位）"})
					return
				}
				if err := admin.AddUser(ctx, input.Name, input.Password); err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 201, map[string]string{"name": input.Name})
				return
			}
			if len(parts) == 2 && managementNameOK(parts[1]) {
				name := parts[1]
				if r.Method == http.MethodGet {
					u, err := admin.GetUserInfo(ctx, name)
					if err != nil {
						managementError(w, err)
						return
					}
					managementJSON(w, 200, map[string]interface{}{"name": name, "status": u.Status, "policy": u.PolicyName, "groups": u.MemberOf, "auth": u.AuthInfo})
					return
				}
				if name == claims.AccountAccessKey {
					managementJSON(w, 409, map[string]string{"error": "不能在当前会话中修改自己的账户"})
					return
				}
				if r.Method == http.MethodDelete {
					if err := admin.RemoveUser(ctx, name); err != nil {
						managementError(w, err)
						return
					}
					managementJSON(w, 200, map[string]bool{"ok": true})
					return
				}
				if r.Method == http.MethodPut {
					var input struct {
						Status   string `json:"status"`
						Password string `json:"password"`
					}
					if managementBody(r, &input) != nil {
						managementJSON(w, 400, map[string]string{"error": "输入无效"})
						return
					}
					if input.Password != "" {
						if len(input.Password) < 8 {
							managementJSON(w, 400, map[string]string{"error": "密码至少 8 位"})
							return
						}
						if err := admin.AddUser(ctx, name, input.Password); err != nil {
							managementError(w, err)
							return
						}
					} else if input.Status == "enabled" || input.Status == "disabled" {
						if err := admin.SetUserStatus(ctx, name, madmin.AccountStatus(input.Status)); err != nil {
							managementError(w, err)
							return
						}
					} else {
						managementJSON(w, 400, map[string]string{"error": "状态无效"})
						return
					}
					managementJSON(w, 200, map[string]bool{"ok": true})
					return
				}
			}
		case "groups":
			if len(parts) == 1 && r.Method == http.MethodGet {
				groups, err := admin.ListGroups(ctx)
				if err != nil {
					managementError(w, err)
					return
				}
				sort.Strings(groups)
				managementJSON(w, 200, groups)
				return
			}
			if len(parts) == 2 && managementNameOK(parts[1]) && r.Method == http.MethodGet {
				group, err := admin.GetGroupDescription(ctx, parts[1])
				if err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 200, group)
				return
			}
			if len(parts) == 2 && managementNameOK(parts[1]) && r.Method == http.MethodPut {
				var input struct {
					Member string `json:"member"`
					Remove bool   `json:"remove"`
					Status string `json:"status"`
				}
				if managementBody(r, &input) != nil {
					managementJSON(w, 400, map[string]string{"error": "输入无效"})
					return
				}
				if input.Member != "" && managementNameOK(input.Member) {
					if err := admin.UpdateGroupMembers(ctx, madmin.GroupAddRemove{Group: parts[1], Members: []string{input.Member}, IsRemove: input.Remove}); err != nil {
						managementError(w, err)
						return
					}
				} else if input.Status == "enabled" || input.Status == "disabled" {
					if err := admin.SetGroupStatus(ctx, parts[1], madmin.GroupStatus(input.Status)); err != nil {
						managementError(w, err)
						return
					}
				} else {
					managementJSON(w, 400, map[string]string{"error": "成员或状态无效"})
					return
				}
				managementJSON(w, 200, map[string]bool{"ok": true})
				return
			}
			if len(parts) == 1 && r.Method == http.MethodPost {
				var input struct {
					Name    string   `json:"name"`
					Members []string `json:"members"`
				}
				if managementBody(r, &input) != nil || !managementNameOK(input.Name) || len(input.Members) == 0 {
					managementJSON(w, 400, map[string]string{"error": "请填写组名和至少一名成员"})
					return
				}
				for _, m := range input.Members {
					if !managementNameOK(m) {
						managementJSON(w, 400, map[string]string{"error": "成员名称无效"})
						return
					}
				}
				if err := admin.UpdateGroupMembers(ctx, madmin.GroupAddRemove{Group: input.Name, Members: input.Members}); err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 201, map[string]string{"name": input.Name})
				return
			}
		case "policies":
			if len(parts) == 1 && r.Method == http.MethodGet {
				policies, err := admin.ListCannedPolicies(ctx)
				if err != nil {
					managementError(w, err)
					return
				}
				names := make([]string, 0, len(policies))
				for n := range policies {
					names = append(names, n)
				}
				sort.Strings(names)
				managementJSON(w, 200, names)
				return
			}
			if len(parts) == 2 && managementNameOK(parts[1]) {
				name := parts[1]
				if r.Method == http.MethodGet {
					policy, err := admin.InfoCannedPolicy(ctx, name)
					if err != nil {
						managementError(w, err)
						return
					}
					managementJSON(w, 200, json.RawMessage(policy))
					return
				}
				if r.Method == http.MethodDelete {
					if err := admin.RemoveCannedPolicy(ctx, name); err != nil {
						managementError(w, err)
						return
					}
					managementJSON(w, 200, map[string]bool{"ok": true})
					return
				}
				if r.Method == http.MethodPut {
					var doc json.RawMessage
					if managementBody(r, &doc) != nil || len(doc) == 0 || doc[0] != '{' {
						managementJSON(w, 400, map[string]string{"error": "策略必须是 JSON 对象"})
						return
					}
					if err := admin.AddCannedPolicy(ctx, name, doc); err != nil {
						managementError(w, err)
						return
					}
					managementJSON(w, 200, map[string]string{"name": name})
					return
				}
			}
		case "associations":
			if len(parts) == 1 && r.Method == http.MethodPost {
				var input struct {
					Policy string `json:"policy"`
					User   string `json:"user"`
					Group  string `json:"group"`
					Remove bool   `json:"remove"`
				}
				if managementBody(r, &input) != nil || !managementNameOK(input.Policy) || (input.User == "") == (input.Group == "") || (input.User != "" && !managementNameOK(input.User)) || (input.Group != "" && !managementNameOK(input.Group)) {
					managementJSON(w, 400, map[string]string{"error": "策略关联参数无效"})
					return
				}
				req := madmin.PolicyAssociationReq{Policies: []string{input.Policy}, User: input.User, Group: input.Group}
				var err error
				if input.Remove {
					_, err = admin.DetachPolicy(ctx, req)
				} else {
					_, err = admin.AttachPolicy(ctx, req)
				}
				if err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 200, map[string]bool{"ok": true})
				return
			}
		case "keys":
			if len(parts) == 1 && r.Method == http.MethodGet {
				accounts, err := admin.ListServiceAccounts(ctx, claims.AccountAccessKey)
				if err != nil {
					managementError(w, err)
					return
				}
				if accounts.Accounts == nil {
					accounts.Accounts = []madmin.ServiceAccountInfo{}
				}
				managementJSON(w, 200, accounts.Accounts)
				return
			}
			if len(parts) == 1 && r.Method == http.MethodPost {
				var input struct {
					Name        string `json:"name"`
					Description string `json:"description"`
				}
				if managementBody(r, &input) != nil {
					managementJSON(w, 400, map[string]string{"error": "输入无效"})
					return
				}
				creds, err := admin.AddServiceAccount(ctx, madmin.AddServiceAccountReq{Name: input.Name, Description: input.Description})
				if err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 201, map[string]string{"accessKey": creds.AccessKey, "secretKey": creds.SecretKey})
				return
			}
			if len(parts) == 2 && managementNameOK(parts[1]) && r.Method == http.MethodDelete {
				if err := admin.DeleteServiceAccount(ctx, parts[1]); err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 200, map[string]bool{"ok": true})
				return
			}
		case "config":
			if len(parts) == 2 && r.Method == http.MethodGet && managementNameOK(parts[1]) {
				// Help metadata contains field names and documentation, never current secret values.
				help, err := admin.HelpConfigKV(ctx, parts[1], "", false)
				if err != nil {
					managementError(w, err)
					return
				}
				managementJSON(w, 200, help)
				return
			}
		case "buckets":
			if len(parts) >= 3 && managementBucket.MatchString(parts[1]) {
				client, err := newMinioClient(claims, getClientIP(r))
				if err != nil {
					managementError(w, err)
					return
				}
				bucket := parts[1]
				if len(parts) == 3 && parts[2] == "policy" {
					if r.Method == http.MethodGet {
						policy, err := client.GetBucketPolicy(ctx, bucket)
						if err != nil {
							managementError(w, err)
							return
						}
						managementJSON(w, 200, map[string]string{"policy": policy})
						return
					}
					if r.Method == http.MethodPut {
						var input struct {
							Policy string `json:"policy"`
						}
						if managementBody(r, &input) != nil || (input.Policy != "" && !json.Valid([]byte(input.Policy))) {
							managementJSON(w, 400, map[string]string{"error": "桶策略 JSON 无效"})
							return
						}
						if err := client.SetBucketPolicy(ctx, bucket, input.Policy); err != nil {
							managementError(w, err)
							return
						}
						managementJSON(w, 200, map[string]bool{"ok": true})
						return
					}
				}
				if len(parts) == 3 && parts[2] == "versioning" {
					if r.Method == http.MethodGet {
						config, err := client.GetBucketVersioning(ctx, bucket)
						if err != nil {
							managementError(w, err)
							return
						}
						managementJSON(w, 200, map[string]string{"status": config.Status})
						return
					}
					if r.Method == http.MethodPut {
						var input struct {
							Status string `json:"status"`
						}
						if managementBody(r, &input) != nil || (input.Status != minio.Enabled && input.Status != minio.Suspended) {
							managementJSON(w, 400, map[string]string{"error": "版本状态无效"})
							return
						}
						if err := client.SetBucketVersioning(ctx, bucket, minio.BucketVersioningConfiguration{Status: input.Status}); err != nil {
							managementError(w, err)
							return
						}
						managementJSON(w, 200, map[string]bool{"ok": true})
						return
					}
				}
			}
		}
		managementJSON(w, http.StatusNotFound, map[string]string{"error": "管理入口不存在"})
	})
}
