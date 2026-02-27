import Topbar from "../../components/Topbar";
import StartApplyingPanel from "../../components/StartApplyingPanel";
import OverviewBoard from "../../components/OverviewBoard";

export default function DashboardPage() {
  return (
    <div>
      <Topbar title="Overview" />
      <StartApplyingPanel />
      <OverviewBoard />
    </div>
  );
}
