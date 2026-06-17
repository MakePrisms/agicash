import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Separator } from '~/components/ui/separator';
import { UpgradeGuestForm } from '~/features/settings/profile/upgrade-guest-form';
import { useUser } from '~/features/user/user-hooks';
import EditableUsername from './editable-username';

export default function EditProfile() {
  const isGuest = useUser((s) => s.isGuest);

  return (
    <>
      <PageHeader>
        <PageBackButton
          to="/settings"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Edit Profile</PageHeaderTitle>
      </PageHeader>
      <PageContent className="gap-6">
        <EditableUsername />
        {isGuest && (
          <>
            <Separator />
            <UpgradeGuestForm />
          </>
        )}
      </PageContent>
    </>
  );
}
