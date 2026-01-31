import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { ColorModeToggle } from '~/features/theme/color-mode-toggle';
import { useTheme } from '~/features/theme/use-theme';

export default function AppearanceSettings() {
  const { colorMode } = useTheme();

  return (
    <>
      <PageHeader>
        <PageBackButton
          to="/settings"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Appearance</PageHeaderTitle>
      </PageHeader>
      <PageContent>
        <p>Theme: {colorMode}</p>
        <ColorModeToggle />
      </PageContent>
    </>
  );
}
