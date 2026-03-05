import Topbar from "../../../components/Topbar";
import SettingsPanel from "../../../components/SettingsPanel";
import PageWrapper from "../../../components/PageWrapper";

export default function SettingsPage() {
  return (
    <PageWrapper>
      <Topbar title="Settings" />
      <SettingsPanel />
    </PageWrapper>
  );
}
