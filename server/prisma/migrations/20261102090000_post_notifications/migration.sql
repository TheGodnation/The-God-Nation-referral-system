-- New posts, likes and replies now notify people.
ALTER TYPE "NotificationType" ADD VALUE 'POST_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'POST_LIKED';
ALTER TYPE "NotificationType" ADD VALUE 'POST_REPLIED';
