import type { ReactNode } from "react";
import Sidebar from "../../components/Sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard">
      <Sidebar />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
