import { ChevronLeft, X } from 'lucide-react';
import React from 'react';
import {
  LinkWithViewTransition,
  type ViewTransitionLinkProps,
} from '~/lib/transitions';
import { cn } from '~/lib/utils';

export type PageHeaderPosition = 'left' | 'center' | 'right';

interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Page({ children, className, ...props }: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto flex h-dvh w-full flex-col p-4 font-primary sm:items-center sm:px-6 lg:px-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type PageHeaderItemProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  position: PageHeaderPosition;
};

export function PageHeaderItem({
  children,
  position,
  className,
  ...props
}: PageHeaderItemProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
PageHeaderItem.isHeaderItem = true;
PageHeaderItem.defaultPosition = undefined as PageHeaderPosition | undefined;

type ClosePageButtonProps = ViewTransitionLinkProps & {
  position?: PageHeaderPosition;
};

/**
 * @default position - 'left'
 */
export function ClosePageButton({
  className,
  position = 'left',
  ...props
}: ClosePageButtonProps) {
  return (
    <PageHeaderItem position={position}>
      <LinkWithViewTransition {...props}>
        <X />
      </LinkWithViewTransition>
    </PageHeaderItem>
  );
}
ClosePageButton.isHeaderItem = true;
ClosePageButton.defaultPosition = 'left' as PageHeaderPosition;

export type PageBackButtonProps = ViewTransitionLinkProps & {
  position?: PageHeaderPosition;
};

/**
 * @default position - 'left'
 */
export function PageBackButton({
  className,
  position = 'left',
  ...props
}: PageBackButtonProps) {
  return (
    <PageHeaderItem position={position}>
      <LinkWithViewTransition {...props}>
        <ChevronLeft />
      </LinkWithViewTransition>
    </PageHeaderItem>
  );
}
PageBackButton.isHeaderItem = true;
PageBackButton.defaultPosition = 'left' as PageHeaderPosition;

type PageHeaderTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  children: React.ReactNode;
  position?: PageHeaderPosition;
};

/**
 * @default position - 'center'
 */
export function PageHeaderTitle({
  children,
  className,
  position = 'center',
  ...props
}: PageHeaderTitleProps) {
  return (
    <PageHeaderItem position={position}>
      <h1
        className={cn('flex items-center justify-start text-xl', className)}
        {...props}
      >
        {children}
      </h1>
    </PageHeaderItem>
  );
}
PageHeaderTitle.isHeaderItem = true;
PageHeaderTitle.defaultPosition = 'center' as PageHeaderPosition;

type PageHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

const isPageHeaderItem = (
  child: React.ReactNode,
): child is React.ReactElement<{ position?: PageHeaderPosition }> => {
  return (
    React.isValidElement(child) &&
    typeof child.type !== 'string' &&
    'isHeaderItem' in child.type &&
    (child.type as { isHeaderItem?: boolean }).isHeaderItem === true
  );
};

export function PageHeader({ children, className, ...props }: PageHeaderProps) {
  const childrenArray = React.Children.toArray(children);

  if (childrenArray.length === 0 || !childrenArray.every(isPageHeaderItem)) {
    throw new Error(
      'PageHeader children must be a component that is marked with isHeaderItem = true',
    );
  }

  const getChildrenByPosition = (pos: PageHeaderPosition) => {
    return childrenArray.filter((child) => {
      if (!React.isValidElement(child)) return false;
      const props = child.props as { position?: PageHeaderPosition };
      const componentType = child.type as {
        defaultPosition?: PageHeaderPosition;
      };
      const position = props.position ?? componentType.defaultPosition;
      return position === pos;
    });
  };

  const leftItems = getChildrenByPosition('left');
  const centerItems = getChildrenByPosition('center');
  const rightItems = getChildrenByPosition('right');

  return (
    <header
      className={cn('mb-4 flex w-full items-center justify-between', className)}
      {...props}
    >
      <div className="flex items-center">{leftItems}</div>
      <div className="-translate-x-1/2 absolute left-1/2 transform">
        {centerItems}
      </div>
      <div className="flex items-center justify-end gap-2">{rightItems}</div>
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
        'flex flex-grow flex-col gap-2 p-2 sm:w-full sm:max-w-sm',
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
        'flex w-full flex-col items-center gap-2 p-2 sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </footer>
  );
}
