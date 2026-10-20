import { useId } from "react";
import styles from "./forms.module.css";

export function FormField({ label, as: Control = "input", children, ...props }) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <Control {...props} id={id} aria-labelledby={`${id}-label`}>{children}</Control>
    </label>
  );
}

export function FormMessage({ type = "success", children }) {
  if (!children) return null;
  return <p className={`${styles.message} ${type === "error" ? "form-error" : "muted"}`} role={type === "error" ? "alert" : "status"}>{children}</p>;
}

export function FormActions({ children }) {
  return <div className={styles.actions}>{children}</div>;
}
