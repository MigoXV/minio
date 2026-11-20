// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { forwardRef, useState } from "react";
import passwordToggle from "./assets/password-toggle.svg";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement>;

// The same native field is used by login and management forms. Native attributes,
// labels, validation and browser password-manager behavior remain intact.
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { className = "", ...props },
  ref,
) {
  return <input {...props} ref={ref} className={`av-field ${className}`} />;
});

export function PasswordField({
  className = "",
  disabled,
  ...props
}: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className={`av-password ${className}`} data-disabled={!!disabled}>
      <Field
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        <img
          src={passwordToggle}
          alt=""
          aria-hidden="true"
          width="32"
          height="32"
        />
      </button>
    </span>
  );
}
