import { ChevronLeft, X } from 'lucide-react';
import React from 'react';
import { useLocation } from 'react-router';
import {
  LinkWithViewTransition,
  type ViewTransitionLinkProps,
} from '~/lib/transitions';
import { cn } from '~/lib/utils';

interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Page({ children, className, ...props }: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto flex h-dvh w-full flex-col font-primary sm:items-center sm:px-6 lg:px-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ClosePageButtonProps extends ViewTransitionLinkProps {}

export function ClosePageButton({ className, ...props }: ClosePageButtonProps) {
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirectTo');
  return (
    <LinkWithViewTransition {...props} to={redirectTo || props.to}>
      <X />
    </LinkWithViewTransition>
  );
}

export interface PageBackButtonProps extends ViewTransitionLinkProps {}

export function PageBackButton({ className, ...props }: PageBackButtonProps) {
  return (
    <LinkWithViewTransition {...props}>
      <ChevronLeft />
    </LinkWithViewTransition>
  );
}

interface PageHeaderTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageHeaderTitle({
  children,
  className,
  ...props
}: PageHeaderTitleProps) {
  return (
    <h1
      className={cn('flex items-center justify-start text-xl', className)}
      {...props}
    >
      {children}
    </h1>
  );
}

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageHeader({ children, className, ...props }: PageHeaderProps) {
  const hasCloseButton = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === ClosePageButton,
  );
  const hasBackButton = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === PageBackButton,
  );

  if (hasCloseButton && hasBackButton) {
    throw new Error(
      'PageHeader cannot have both ClosePageButton and BackButton',
    );
  }

  return (
    <header
      className={cn('flex w-full items-center justify-between p-4', className)}
      {...props}
    >
      {/* Close/back button - always on the left */}
      <div>
        {React.Children.toArray(children).find(
          (child) =>
            React.isValidElement(child) &&
            (child.type === ClosePageButton || child.type === PageBackButton),
        )}
      </div>

      {/* Title - always in the center */}
      <div className="-translate-x-1/2 absolute left-1/2 transform">
        {React.Children.toArray(children).find(
          (child) =>
            React.isValidElement(child) && child.type === PageHeaderTitle,
        )}
      </div>

      {/* Other elements - on the right */}
      <div className="flex items-center justify-end gap-2">
        {React.Children.toArray(children).filter(
          (child) =>
            !React.isValidElement(child) ||
            (child.type !== PageHeaderTitle &&
              child.type !== ClosePageButton &&
              child.type !== PageBackButton),
        )}
      </div>
    </header>
  );
}

interface PageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageContent({
  children,
  className,
  ...props
}: PageContentProps) {
  return (
    <main
      className={cn(
        'flex flex-grow flex-col gap-2 px-4 sm:w-full sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </main>
  );
}

interface PageFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageFooter({ children, className, ...props }: PageFooterProps) {
  return (
    <footer
      className={cn(
        'flex w-full flex-col items-center gap-2 p-4 pt-2 sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </footer>
  );
}
