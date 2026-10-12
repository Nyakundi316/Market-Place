import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A styled <select>. Native on purpose: long lists (countries, categories)
 * get the platform picker on mobile, which beats any custom popover at 375px.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-input bg-transparent py-1 pl-3 pr-9 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
