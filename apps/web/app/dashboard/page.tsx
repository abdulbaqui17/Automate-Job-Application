import Topbar from "../../components/Topbar";
import StartApplyingPanel from "../../components/StartApplyingPanel";
import OverviewBoard from "../../components/OverviewBoard";
import PageWrapper from "../../components/PageWrapper";

export default function DashboardPage() {
  return (
    <PageWrapper>
      <Topbar title="Overview" />
      <StartApplyingPanel />
      <OverviewBoard />
    </PageWrapper>
  );
}
