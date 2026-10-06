import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function ProfileAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-9', className)}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
        {initials(name) || '?'}
      </AvatarFallback>
    </Avatar>
  );
}
