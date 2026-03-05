import Topbar from "../../../components/Topbar";
import AnalyticsBoard from "../../../components/AnalyticsBoard";
import PageWrapper from "../../../components/PageWrapper";

export default function AnalyticsPage() {
  return (
    <PageWrapper>
      <Topbar title="Analytics" />
      <AnalyticsBoard />
    </PageWrapper>
  );
}
