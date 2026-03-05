import Topbar from "../../../components/Topbar";
import ResumeViewer from "../../../components/ResumeViewer";
import PageWrapper from "../../../components/PageWrapper";

export default function ResumeViewerPage() {
  return (
    <PageWrapper>
      <Topbar title="Resumes & Cover Letters" />
      <ResumeViewer />
    </PageWrapper>
  );
}
