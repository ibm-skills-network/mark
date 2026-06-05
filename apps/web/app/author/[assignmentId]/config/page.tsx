import PageTitle from "@authorComponents/PageTitle";
import { ConfigGroups } from "@authorComponents/StepTwo/ConfigGroups";
import { FooterNavigation } from "@authorComponents/StepTwo/FooterNavigation";

function Component() {
  return (
    <main className="main-author-container">
      <PageTitle
        title="Assignment Settings"
        description="Set up the assignment parameters. You can review and edit these later."
      />

      <ConfigGroups />
      <FooterNavigation />
    </main>
  );
}

export default Component;
