import { Clock, Send } from "lucide-react";
import { Avatar } from "../../components/PlayerMedia.jsx";
import { PageHeader } from "../../components/PageLayout.jsx";
import { FriendPlanner } from "./FriendPlanner.jsx";
import styles from "./friends.module.css";

export function FriendsView({ user, friends, availability, events, onPlan }) {
  return (
    <>
      <PageHeader>
        <div>
          <h1>Friends</h1>
          <p>Account list, availability counts, and invite activity.</p>
        </div>
      </PageHeader>
      <FriendPlanner user={user} friends={friends} onPlan={onPlan} />
      <section className={styles.list}>
        {friends.length === 0 && <p className="muted">No friends yet. Ask someone to create an account.</p>}
        {friends.map((friend) => {
          const freeCount = availability.filter((item) => item.userId === friend.id).length;
          const inviteCount = events.filter((event) => event.invites.some((invite) => invite.userId === friend.id)).length;
          return (
            <article className={styles.row} key={friend.id}>
              <div className={styles.person}>
                <Avatar user={friend} size="small" />
                <div>
                <strong>{friend.displayName}</strong>
                <span>@{friend.username}{friend.discordUsername ? ` - ${friend.discordUsername}` : ""}</span>
                </div>
              </div>
              <div className={styles.stat}><Clock size={16} /> {freeCount} free slots</div>
              <div className={styles.stat}><Send size={16} /> {inviteCount} invites</div>
            </article>
          );
        })}
      </section>
    </>
  );
}
