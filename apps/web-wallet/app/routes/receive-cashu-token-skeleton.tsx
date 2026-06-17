import {
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Skeleton } from '~/components/ui/skeleton';

/**
 * Skeleton loading state for ReceiveCashuToken component
 * Matches the layout of the actual component with token amount, account selector, and claim button
 */
export function ReceiveCashuTokenSkeleton() {
  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to="/receive"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>

      <PageContent className="flex flex-col items-center">
        {/* Token amount display skeleton */}
        <div className="z-10 flex flex-col items-center gap-2 py-8">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-6 w-32" />
        </div>

        {/* Account selector skeleton - positioned to match actual component */}
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <div className="w-full max-w-sm px-4">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="mb-1 h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </PageContent>

      {/* Claim button skeleton */}
      <PageFooter className="pb-14">
        <Skeleton className="h-10 w-[200px] rounded-md" />
      </PageFooter>
    </>
  );
}
