// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { AppState, useAppDispatch } from "../../store";
import { setHelpName } from "../../systemSlice";
import { getFetchConfigurationAsync } from "./loginThunks";
import { resetForm } from "./loginSlice";
import { loginStrategyType } from "./login.types";
import StrategyForm from "./StrategyForm";
import AppearanceMenu from "custom/Appearance";
import logo from "custom/assets/minio-logo.svg";
import "custom/login.css";

export const getTargetPath = () => {
  const target = localStorage.getItem("redirect-path") || "/browser";
  localStorage.removeItem("redirect-path");
  return target;
};

export default function Login() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loginStrategy, loadingFetchConfiguration, navigateTo } = useSelector(
    (s: AppState) => s.login,
  );
  useEffect(() => {
    dispatch(getFetchConfigurationAsync());
    dispatch(setHelpName("login"));
  }, [dispatch]);
  useEffect(() => {
    if (navigateTo) {
      dispatch(resetForm());
      navigate(navigateTo);
    }
  }, [navigateTo, dispatch, navigate]);
  return (
    <main className="av-login" aria-label="登录控制台">
      <header className="av-login-header">
        <img
          className="av-login-logo"
          src={logo}
          alt="MinIO"
          width="120"
          height="21"
        />
        <AppearanceMenu />
      </header>
      <div className="av-login-center">
        {loginStrategy.loginStrategy === loginStrategyType.form ? (
          <StrategyForm redirectRules={loginStrategy.redirectRules || []} />
        ) : (
          <section className="av-login-service" aria-live="polite">
            <h1>登录控制台</h1>
            {loadingFetchConfiguration ? (
              <p role="status">正在连接服务…</p>
            ) : (
              <>
                <p role="alert">暂时无法连接服务，请稍后重试。</p>
                <button
                  className="av-button"
                  onClick={() => dispatch(getFetchConfigurationAsync())}
                >
                  重试
                </button>
              </>
            )}
          </section>
        )}
      </div>
      <footer className="av-login-help">
        <a
          href="https://docs.min.io/community/minio-object-store/index.html?ref=con"
          target="_blank"
          rel="noopener noreferrer"
        >
          使用文档
        </a>
        <a
          href="https://github.com/minio/minio"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a
          href="https://subnet.min.io/?ref=con"
          target="_blank"
          rel="noopener noreferrer"
        >
          技术支持
        </a>
        <a
          href="https://min.io/download/?ref=con"
          target="_blank"
          rel="noopener noreferrer"
        >
          下载
        </a>
      </footer>
    </main>
  );
}
