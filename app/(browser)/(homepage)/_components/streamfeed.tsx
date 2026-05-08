import { Skeleton } from "@/components/ui/skeleton";
import { GetHomepageFeed } from "@/lib/homepagefeed-service";
import { FeedCard, FeedCardSkeleton } from "./feedcard";
import { DatabaseError } from "@/components/ui/database-error";

// Force dynamic rendering since this page depends on real-time data
export const dynamic = 'force-dynamic';

export const Feed = async () => {
  let feed: Awaited<ReturnType<typeof GetHomepageFeed>> = [];
  let dbError = false;

  try {
    feed = await GetHomepageFeed();
  } catch (error) {
    console.error('Error fetching feed:', error);
    dbError = true;
  }
  
  if (dbError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <DatabaseError 
          message="Unable to load streams. The database may be temporarily unavailable."
        />
      </div>
    );
  }

  return (
        <div>
            <h2 className="text-lg font-semibold mb-4">
                Recommended Streams
            </h2>
            {feed.length === 0 && (
                <div className="text-muted-foreground text-sm">
                    No one is live right now. Check back later!
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {feed.map((feed) => (
              <FeedCard key={feed.id} data={feed} />
            ))}
            </div>
        </div>
    );
}

export const FeedSkeleton = () => {
    return (
        <div>
          <Skeleton className="h-8 w-[290px] mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {[...Array(4)].map((_, i) => (
             <FeedCardSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    }
