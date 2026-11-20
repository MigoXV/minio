// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { LoginDetails } from "api/consoleApi";
import { doLoginAsync, getFetchConfigurationAsync } from "./loginThunks";
import { LoginFailure } from "./loginFeedback";

interface LoginState {
  accessKey: string;
  secretKey: string;
  backgroundAnimation: boolean;
  loginStrategy: LoginDetails;
  loginSending: boolean;
  loadingFetchConfiguration: boolean;
  navigateTo: string;
  loginFailure: LoginFailure | null;
}
const initialState: LoginState = {
  accessKey: "",
  secretKey: "",
  backgroundAnimation: false,
  loginStrategy: { loginStrategy: undefined, redirectRules: [] },
  loginSending: false,
  loadingFetchConfiguration: true,
  navigateTo: "",
  loginFailure: null,
};
const slice = createSlice({
  name: "login",
  initialState,
  reducers: {
    setAccessKey(s, a: PayloadAction<string>) {
      s.accessKey = a.payload;
      s.loginFailure = null;
    },
    setSecretKey(s, a: PayloadAction<string>) {
      s.secretKey = a.payload;
      s.loginFailure = null;
    },
    setNavigateTo(s, a: PayloadAction<string>) {
      s.navigateTo = a.payload;
    },
    resetForm: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(getFetchConfigurationAsync.pending, (s) => {
      s.loadingFetchConfiguration = true;
    })
      .addCase(getFetchConfigurationAsync.rejected, (s) => {
        s.loadingFetchConfiguration = false;
      })
      .addCase(getFetchConfigurationAsync.fulfilled, (s, a) => {
        s.loadingFetchConfiguration = false;
        if (a.payload) s.loginStrategy = a.payload;
      })
      .addCase(doLoginAsync.pending, (s) => {
        s.loginSending = true;
        s.loginFailure = null;
      })
      .addCase(doLoginAsync.rejected, (s, a) => {
        s.loginSending = false;
        s.loginFailure = a.payload || {
          kind: "unavailable",
          message: "暂时无法连接服务，请稍后重试。",
        };
      })
      .addCase(doLoginAsync.fulfilled, (s) => {
        s.loginSending = false;
        s.loginFailure = null;
      });
  },
});
export const { setAccessKey, setSecretKey, setNavigateTo, resetForm } =
  slice.actions;
export default slice.reducer;
