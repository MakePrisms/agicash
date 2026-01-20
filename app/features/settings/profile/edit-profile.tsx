import { PageContent } from '~/components/page';
import { Separator } from '~/components/ui/separator';
import { UpgradeGuest } from '~/features/settings/profile/upgrade-guest';
import { SettingsViewHeader } from '~/features/settings/ui/settings-view-header';
import { useUser } from '~/features/user/user-hooks';
import EditableUsername from './editable-username';

export default function EditProfile() {
  const isGuest = useUser((s) => s.isGuest);

  return (
    <>
      <SettingsViewHeader
        title="Edit Profile"
        navBack={{
          to: '/settings',
          transition: 'slideRight',
          applyTo: 'oldView',
        }}
      />
      <PageContent className="gap-6">
        <EditableUsername />
        {isGuest && (
          <>
            <Separator />
            <UpgradeGuest />
          </>
        )}
      </PageContent>
    </>
  );
}
