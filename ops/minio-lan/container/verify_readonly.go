// Command verify_readonly checks the production backend without changing data.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type result struct {
	BucketCount     int    `json:"bucketCount"`
	ObjectCount     int    `json:"objectCount"`
	ObjectBytes     int64  `json:"objectBytes"`
	InventorySHA256 string `json:"inventorySHA256"`
	SampleRead      bool   `json:"sampleRead"`
	ConsoleLogin    bool   `json:"consoleLogin"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	prod := os.Getenv("MINIO_PROD_DIR")
	if prod == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		prod = filepath.Join(home, ".local/share/minio-prod")
	}
	readSecret := func(name string) (string, error) {
		b, err := os.ReadFile(filepath.Join(prod, "secrets", name))
		return strings.TrimSpace(string(b)), err
	}
	user, err := readSecret("root-user")
	if err != nil {
		return err
	}
	password, err := readSecret("root-password")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	s3Endpoint := os.Getenv("MINIO_VERIFY_S3_ENDPOINT")
	if s3Endpoint == "" {
		s3Endpoint = "127.0.0.1:19000"
	}
	consoleEndpoint := os.Getenv("MINIO_VERIFY_CONSOLE_ENDPOINT")
	if consoleEndpoint == "" {
		consoleEndpoint = "127.0.0.1:19001"
	}
	httpClient := &http.Client{Timeout: 10 * time.Second}
	for _, target := range []string{
		"http://" + s3Endpoint + "/minio/health/ready",
		"http://" + consoleEndpoint + "/",
	} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return err
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("%s returned HTTP %d", target, resp.StatusCode)
		}
	}
	loginBody, err := json.Marshal(map[string]string{"accessKey": user, "secretKey": password})
	if err != nil {
		return err
	}
	loginReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"http://"+consoleEndpoint+"/api/v1/login", bytes.NewReader(loginBody))
	if err != nil {
		return err
	}
	loginReq.Header.Set("Content-Type", "application/json")
	loginResp, err := httpClient.Do(loginReq)
	if err != nil {
		return fmt.Errorf("console login: %w", err)
	}
	loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("console login returned HTTP %d", loginResp.StatusCode)
	}
	var sessionCookie *http.Cookie
	for _, cookie := range loginResp.Cookies() {
		if cookie.Name == "token" {
			sessionCookie = cookie
			break
		}
	}
	if sessionCookie == nil {
		return fmt.Errorf("console login did not set a session cookie")
	}
	sessionReq, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"http://"+consoleEndpoint+"/api/v1/session", nil)
	if err != nil {
		return err
	}
	sessionReq.AddCookie(sessionCookie)
	sessionResp, err := httpClient.Do(sessionReq)
	if err != nil {
		return fmt.Errorf("console session: %w", err)
	}
	sessionResp.Body.Close()
	if sessionResp.StatusCode != http.StatusOK {
		return fmt.Errorf("console session returned HTTP %d", sessionResp.StatusCode)
	}
	client, err := minio.New(s3Endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(user, password, ""),
		Secure:       false,
		Region:       "us-east-1",
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return err
	}
	buckets, err := client.ListBuckets(ctx)
	if err != nil {
		return fmt.Errorf("signed bucket listing: %w", err)
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].Name < buckets[j].Name })
	sum := sha256.New()
	r := result{BucketCount: len(buckets), ConsoleLogin: true}
	for _, bucket := range buckets {
		fmt.Fprintf(sum, "bucket\x00%s\n", bucket.Name)
		for object := range client.ListObjects(ctx, bucket.Name, minio.ListObjectsOptions{Recursive: true}) {
			if object.Err != nil {
				return fmt.Errorf("list objects in bucket: %w", object.Err)
			}
			r.ObjectCount++
			r.ObjectBytes += object.Size
			fmt.Fprintf(sum, "object\x00%s\x00%s\x00%d\x00%s\n", bucket.Name, object.Key, object.Size, object.ETag)
			if !r.SampleRead {
				reader, err := client.GetObject(ctx, bucket.Name, object.Key, minio.GetObjectOptions{})
				if err != nil {
					return fmt.Errorf("open sample object: %w", err)
				}
				var one [1]byte
				_, err = reader.Read(one[:])
				reader.Close()
				if err != nil && err != io.EOF {
					return fmt.Errorf("read sample object: %w", err)
				}
				r.SampleRead = true
			}
		}
	}
	r.InventorySHA256 = hex.EncodeToString(sum.Sum(nil))
	return json.NewEncoder(os.Stdout).Encode(r)
}
