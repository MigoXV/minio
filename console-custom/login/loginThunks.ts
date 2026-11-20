// SPDX-License-Identifier: AGPL-3.0-or-later
import { createAsyncThunk } from "@reduxjs/toolkit";
import { AppState } from "../../store";
import { setDarkMode, userLogged } from "../../systemSlice";
import { setNavigateTo } from "./loginSlice";
import { getTargetPath } from "./Login";
import { api } from "api";
import { loginFailureFrom, LoginFailure } from "./loginFeedback";

export const doLoginAsync = createAsyncThunk<
  void,
  void,
  { state: AppState; rejectValue: LoginFailure }
>(
  "login/doLoginAsync",
  async (_, { getState, rejectWithValue, dispatch }) => {
    const { accessKey, secretKey } = getState().login;
    try {
      await api.login.login({ accessKey, secretKey });
      dispatch(userLogged(true));
      localStorage.setItem("userLoggedIn", accessKey);
      dispatch(
        setDarkMode(document.documentElement.dataset.theme === "abyssus"),
      );
      dispatch(setNavigateTo(getTargetPath()));
    } catch (error) {
      return rejectWithValue(loginFailureFrom(error));
    }
  },
  { condition: (_, { getState }) => !getState().login.loginSending },
);

export const getFetchConfigurationAsync = createAsyncThunk(
  "login/getFetchConfigurationAsync",
  async (_, { rejectWithValue }) => {
    try {
      return (await api.login.loginDetail()).data;
    } catch {
      return rejectWithValue(false);
    }
  },
);
