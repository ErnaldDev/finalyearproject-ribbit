import { db, withRetry, getDbHealthStatus } from './db';
import { infouser } from './services-fetchuser';

export const GetHomepageFeed = async () => {
  // Check if database is available before attempting query
  const healthStatus = getDbHealthStatus();
  if (healthStatus === 'unavailable') {
    console.warn('Database unavailable - returning empty feed');
    return [];
  }

  let userId: string | null = null;

  try {
    const self = await infouser();
    userId = self.id;
  } catch {
    userId = null;
  }

  try {
    const streamfeed = await withRetry(async () => {
      if (userId) {
        const blockedUserIds = await db.blocking.findMany({
          where: {
            blockedId: userId,
          },
          select: {
            blockerId: true,
          },
        }).then((blocks) => blocks.map((block) => block.blockerId));

        return await db.streaming.findMany({
          where: {
            userId: {
              notIn: blockedUserIds,
            },
          },
          include: {
            user: true,
          },
          orderBy: [
            {
              isLive: 'desc',
            },
            {
              updatedAt: 'desc',
            },
          ],
        });
      } else {
        return await db.streaming.findMany({
          include: {
            user: true,
          },
          orderBy: [
            {
              isLive: 'desc',
            },
            {
              updatedAt: 'desc',
            },
          ],
        });
      }
    }, {
      maxRetries: 3,
      fallbackValue: [] as any[],
    });

    return streamfeed;
  } catch (error) {
    console.error('Failed to fetch homepage feed:', error);
    return [];
  }
};