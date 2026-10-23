// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { AddIcon, BucketsIcon, DocumentationIcon, LogoutIcon } from "mds";
import { api } from "../api";
import { AppState, useAppDispatch } from "../store";
import { setBucketLoadListing, setErrorSnackMessage } from "../systemSlice";
import { errorToHandler } from "../api/errors";
import { Bucket } from "../api/consoleApi";
import { setAddBucketOpen } from "../screens/Console/Buckets/ListBuckets/AddBucket/addBucketsSlice";
import { hasPermission } from "../common/SecureComponent";
import { IAM_SCOPES } from "../common/SecureComponent/permissions";
import Icon from "./Icon";
import "./management.css";
export default function WorkspaceMenu() {
  const dispatch = useAppDispatch(),
    navigate = useNavigate(),
    location = useLocation();
  const reload = useSelector((s: AppState) => s.system.loadBucketsListing);
  const [buckets, setBuckets] = useState<Bucket[]>([]),
    [filter, setFilter] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.buckets
      .listBuckets()
      .then((r) => {
        if (alive) {
          setBuckets(r.data.buckets || []);
          dispatch(setBucketLoadListing(false));
        }
      })
      .catch((e) => {
        if (alive) {
          dispatch(setBucketLoadListing(false));
          dispatch(setErrorSnackMessage(errorToHandler(e)));
        }
      });
    return () => {
      alive = false;
    };
  }, [reload, dispatch]);
  const go = (url: string) => {
    navigate(url);
    setOpen(false);
  };
  const current = decodeURIComponent(location.pathname.split("/")[2] || "");
  return (
    <>
      <button
        className="av-mobile-menu av-button"
        aria-label="存储桶导航"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>
      <nav className={`av-nav ${open ? "av-open" : ""}`} aria-label="主导航">
        <div className="av-brand">
          <b>MinIO</b>
          <small>对象存储 · 社区版</small>
        </div>
        <button
          className="av-button"
          disabled={!hasPermission("*", [IAM_SCOPES.S3_CREATE_BUCKET])}
          onClick={() => dispatch(setAddBucketOpen(true))}
        >
          <AddIcon />
          创建存储桶
        </button>
        <label className="av-search">
          <Icon name="search" />
          <input
            aria-label="筛选存储桶"
            placeholder="筛选存储桶"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="av-nav-heading">
          存储桶<span>{buckets.length}</span>
        </div>
        <div className="av-buckets">
          {buckets
            .filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))
            .map((b) => (
              <button
                type="button"
                className={`av-bucket ${current === b.name ? "selected" : ""}`}
                aria-current={current === b.name ? "page" : undefined}
                key={b.name}
                id={`manageBucket-${b.name}`}
                onClick={() => go(`/browser/${encodeURIComponent(b.name)}`)}
              >
                <BucketsIcon />
                <span>{b.name}</span>
              </button>
            ))}
        </div>
        <div className="av-manage-navlist">
          <div className="av-nav-heading">工作区</div>
          <button
            className="av-nav-link"
            aria-current={
              location.pathname.startsWith("/browser") ? "page" : undefined
            }
            onClick={() => go("/browser")}
          >
            对象浏览
          </button>
          {hasPermission("*", [IAM_SCOPES.ADMIN_SERVER_INFO]) && (
            <button
              className="av-nav-link"
              aria-current={
                location.pathname.startsWith("/manage/overview")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/manage/overview")}
            >
              系统概览
            </button>
          )}
          <button
            className="av-nav-link"
            aria-current={
              location.pathname.startsWith("/manage/buckets")
                ? "page"
                : undefined
            }
            onClick={() => go("/manage/buckets")}
          >
            存储桶配置
          </button>
          {hasPermission("*", [IAM_SCOPES.ADMIN_LIST_USERS]) && (
            <button
              className="av-nav-link"
              aria-current={
                location.pathname.startsWith("/manage/users")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/manage/users")}
            >
              用户
            </button>
          )}
          {hasPermission("*", [IAM_SCOPES.ADMIN_LIST_GROUPS]) && (
            <button
              className="av-nav-link"
              aria-current={
                location.pathname.startsWith("/manage/groups")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/manage/groups")}
            >
              组
            </button>
          )}
          {hasPermission("*", [IAM_SCOPES.ADMIN_GET_POLICY]) && (
            <button
              className="av-nav-link"
              aria-current={
                location.pathname.startsWith("/manage/policies")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/manage/policies")}
            >
              策略
            </button>
          )}
          <button
            className="av-nav-link"
            aria-current={
              location.pathname.startsWith("/manage/keys") ? "page" : undefined
            }
            onClick={() => go("/manage/keys")}
          >
            访问密钥
          </button>
          {hasPermission("*", [IAM_SCOPES.ADMIN_SERVER_INFO]) && (
            <button
              className="av-nav-link"
              aria-current={
                location.pathname.startsWith("/manage/config")
                  ? "page"
                  : undefined
              }
              onClick={() => go("/manage/config")}
            >
              系统配置
            </button>
          )}
        </div>
        <a
          className="av-nav-link"
          href="https://docs.min.io/community/minio-object-store/index.html"
          target="_blank"
          rel="noreferrer"
        >
          <DocumentationIcon />
          使用文档
        </a>
        <button className="av-nav-link" onClick={() => go("/license")}>
          许可证
        </button>
        <button className="av-nav-link av-logout" onClick={() => go("/logout")}>
          <LogoutIcon />
          退出登录
        </button>
      </nav>
    </>
  );
}
