// A person's avatar anywhere in the dashboard: their profile photo when the
// row carries one or the loaded directory has one, else their initials.
import type { ComponentProps } from 'react';
import { Avatar } from './ui';
import { usePhotoFor } from './photos';

export function PersonAvatar({
  userId,
  src,
  ...rest
}: ComponentProps<typeof Avatar> & {
  /** Looked up in the employee directory; the name is the fallback key. */
  userId?: string | null;
}) {
  const found = usePhotoFor(src ? null : userId, src ? null : rest.name);
  return <Avatar {...rest} src={src || found} />;
}
