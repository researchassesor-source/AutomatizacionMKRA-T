import type { ReactNode } from "react";
import { AdminIcon, type AdminIconName } from "./AdminIcon";

type AdminEmptyStateProps = {
  icon?: AdminIconName;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function AdminEmptyState({ icon = "search", title, description, action }: AdminEmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><AdminIcon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
