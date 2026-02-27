"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/discovery", label: "Discovery" },
  { href: "/dashboard/jobs", label: "Jobs" },
  { href: "/dashboard/resume-viewer", label: "Documents" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/queue", label: "Queue" },
  { href: "/dashboard/logs", label: "Logs" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <h2>ApplyCraft</h2>
      <nav className="nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? "active" : ""}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
