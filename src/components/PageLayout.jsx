import styles from "./page-layout.module.css";

export function PageHeader({ children }) {
  return <header className={styles.header}>{children}</header>;
}

export function FormGrid({ children }) {
  return <div className={styles.formGrid}>{children}</div>;
}
