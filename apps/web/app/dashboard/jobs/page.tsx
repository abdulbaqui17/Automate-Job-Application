import Topbar from "../../../components/Topbar";
import JobsBoard from "../../../components/JobsBoard";
import PageWrapper from "../../../components/PageWrapper";

export default function JobsPage() {
  return (
    <PageWrapper>
      <Topbar title="Jobs" />
      <JobsBoard />
    </PageWrapper>
  );
}
