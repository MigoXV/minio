// SPDX-License-Identifier: AGPL-3.0-or-later
import { loginFailureFrom } from "./loginFeedback";

test("rejected credentials have the specified recovery message", () => {
  expect(
    loginFailureFrom({
      status: 401,
      json: () => Promise.reject(new Error("HTML proxy response")),
    }),
  ).toEqual({
    kind: "credentials",
    message: "用户名或密码不正确，请核对后重试。",
  });
});
test.each([
  new TypeError("Failed to fetch"),
  { status: 503 },
  { status: 502 },
  undefined,
])("service failures are not reported as bad credentials", (error) => {
  expect(loginFailureFrom(error).kind).toBe("unavailable");
});
test.each([400, 403])(
  "account restrictions are distinct from credentials and outages",
  (status) => {
    expect(loginFailureFrom({ status }).kind).toBe("forbidden");
  },
);
