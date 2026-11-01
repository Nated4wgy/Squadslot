import { Clock, Send } from "lucide-react";
import { Avatar } from "../../components/PlayerMedia.jsx";
import { PageHeader } from "../../components/PageLayout.jsx";

export function FriendsView({ friends, availability, events }) {
  return (
    <>
      <PageHeader>
        <div>
          <h1>Friends</h1>
          <p>Account list, availability counts, and invite activity.</p>
        </div>
      </PageHeader>
      <section className="table-panel">
        {friends.length === 0 && <p className="muted">No friends yet. Ask someone to create an account.</p>}
        {friends.map((friend) => {
          const freeCount = availability.filter((item) => item.userId === friend.id).length;
          const inviteCount = events.filter((event) => event.invites.some((invite) => invite.userId === friend.id)).length;
          return (
            <article className="friend-row" key={friend.id}>
              <div className="person-line">
                <Avatar user={friend} size="small" />
                <div>
                <strong>{friend.displayName}</strong>
                <span>@{friend.username}{friend.discordUsername ? ` - ${friend.discordUsername}` : ""}</span>
                </div>
              </div>
              <div><Clock size={16} /> {freeCount} free slots</div>
              <div><Send size={16} /> {inviteCount} invites</div>
            </article>
          );
        })}
      </section>
    </>
  );
}
