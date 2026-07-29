import type { SVGProps } from "react";

export type AdminIconName =
  | "activity"
  | "alert"
  | "arrow"
  | "audit"
  | "calendar"
  | "chevron"
  | "close"
  | "contacts"
  | "courses"
  | "external"
  | "finance"
  | "followups"
  | "logout"
  | "menu"
  | "messages"
  | "overview"
  | "search"
  | "secure"
  | "social"
  | "users"
  | "sales";

type IconProps = SVGProps<SVGSVGElement> & {
  name: AdminIconName;
  size?: number;
};

const paths: Record<AdminIconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  contacts: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  followups: <><path d="M12 8v4l2.5 1.5" /><circle cx="12" cy="12" r="9" /><path d="M12 3V1M3 12H1" /></>,
  sales: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V2" /><path d="M2 19h22" /></>,
  courses: <><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M7 9.5V15c0 1.2 2.2 3 5 3s5-1.8 5-3V9.5M21 7v6" /></>,
  finance: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h2M12 15h5" /></>,
  messages: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4v8Z" /><path d="M7 8h10M7 12h7" /></>,
  social: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.1M8.7 13.3l6.6 4.1" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M16 5.2a4 4 0 0 1 0 7.6M18 15a6 6 0 0 1 4 6" /></>,
  audit: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  external: <><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  alert: <><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  activity: <><path d="M3 12h4l2-8 4 16 2-8h6" /></>,
  secure: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
};

export function AdminIcon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
