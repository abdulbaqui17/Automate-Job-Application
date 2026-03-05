import Topbar from "../../../components/Topbar";
import JobLinksBoard from "../../../components/JobLinksBoard";
import PageWrapper from "../../../components/PageWrapper";

export default function JobLinksPage() {
  return (
    <PageWrapper>
      <Topbar title="Job Links" />
      <JobLinksBoard />
    </PageWrapper>
  );
}
