// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { AppState, useAppDispatch } from "../../store";
import { setAccessKey, setSecretKey } from "./loginSlice";
import { doLoginAsync } from "./loginThunks";
import { RedirectRule } from "api/consoleApi";
import { Field } from "custom/Field";

export default function StrategyForm(_props: {
  redirectRules: RedirectRule[];
}) {
  const dispatch = useAppDispatch();
  const [showPassword, setShowPassword] = useState(false);
  const { accessKey, secretKey, loginSending, loginFailure } = useSelector(
    (s: AppState) => s.login,
  );
  const state = loginSending ? "sending" : loginFailure ? "error" : "default";
  return (
    <form
      className="av-login-form"
      aria-busy={loginSending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!loginSending && accessKey && secretKey) dispatch(doLoginAsync());
      }}
    >
      <div className="av-login-title">
        <h1>登录控制台</h1>
        <p>访问存储桶、对象与音频工具。</p>
      </div>
      <div className="av-login-credentials">
        <label htmlFor="accessKey">
          用户名
          <Field
            id="accessKey"
            name="accessKey"
            autoComplete="username"
            placeholder="请输入用户名"
            value={accessKey}
            disabled={loginSending}
            aria-invalid={!!loginFailure}
            required
            aria-describedby="login-feedback"
            onChange={(e) => dispatch(setAccessKey(e.target.value))}
          />
        </label>
        <label htmlFor="secretKey">
          密码
          <Field
            id="secretKey"
            name="secretKey"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={secretKey}
            disabled={loginSending}
            aria-invalid={!!loginFailure}
            required
            aria-describedby="login-feedback"
            onChange={(e) => dispatch(setSecretKey(e.target.value))}
          />
        </label>
      </div>
      <button
        type="button"
        className="v2-text-button av-login-show"
        aria-pressed={showPassword}
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? "隐藏密码" : "显示密码"}
      </button>
      <button
        id="do-login"
        type="submit"
        className="av-button av-primary"
        disabled={loginSending}
      >
        {loginSending ? "登录中…" : "登录"}
      </button>
      <div
        id="login-feedback"
        className="av-login-feedback"
        data-state={state}
        aria-live="polite"
        aria-atomic="true"
      >
        {loginSending ? (
          <>
            <p role="status">正在验证凭据，请稍候。</p>
          </>
        ) : loginFailure ? (
          <>
            <p role="alert">{loginFailure.message}</p>
          </>
        ) : (
          <p>使用管理员分配的用户名和密码登录。</p>
        )}
      </div>
    </form>
  );
}
