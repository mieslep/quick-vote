# Quick Vote

Ranked-choice voting for classes, clubs, teams and events. No accounts. No app to install.

Quick Vote lets a group choose between options fairly. Each voter ranks the choices: first, second, third. The app then counts the votes with *instant runoff*, and shows every round, so everyone can see how the winner came about.

Use it to choose:
- a class project topic, a field trip or a party menu;
- a name for a team, a club or a product;
- a date, a venue or a prize.

## Why ranked-choice?

With a normal vote, each person picks one option. Similar options split the vote, and the winner can be a choice that most people did not want.

With ranked-choice voting, a voter says which option they like best, and which they like next. If the voter's first choice cannot win, the vote moves to the voter's next choice. The winner is an option that a majority of voters can accept. A voter never has to guess a "safe" choice.

**Example.** Twelve voters, three options. The first-choice votes are Pizza 5, Pasta 4 and Tacos 3. Nobody has more than half (7). Tacos has the fewest, so Tacos is out. The three voters who chose Tacos first all ranked Pasta second, so their votes move to Pasta. Pasta now has 7 of 12 and wins, even though Pizza had the most first-choice votes. The round-by-round view shows each step.

## Two ways to use it

| | Single-booth poll | Multi-booth poll |
|---|---|---|
| Good for | One class or one room | Many classes, rooms or sites |
| Voters use | One shared device | A device in each group |
| Needs a server | No | Yes (a Cloudflare account; the free plan is usually enough) |
| Needs a network | Only to load the site once | Each booth needs a signal to open and to send votes |
| Result | On the device | The total of all booths, with a result for each booth |
| Set up | None | About 20 minutes, once: see [INSTALLING.md](INSTALLING.md) |

### Single-booth poll

Click **Make a single-booth poll**. Enter the question and the choices. Add a picture to a choice if you like. Choose a password to close voting.

Pass the device around. Each voter taps the choices in order and presses **Cast my vote**. When everyone has voted, you press **Close voting and show the result** and type the password.

- Nothing leaves the device. The poll, the votes and the result stay in the browser.
- It works with no network, after the site has loaded once.
- You can download the votes as a CSV file, reopen voting, or delete the poll. Each of these needs the password.
- Clearing the browser data deletes the poll. Download the CSV first, if you need a record.

### Multi-booth poll

Many groups vote at the same time, each on its own device. A server that you control (the *voting centre*) adds up all the votes.

1. **Set up once.** Follow [INSTALLING.md](INSTALLING.md). It takes about 20 minutes. It needs a Cloudflare account. The free plan is usually enough.
2. **Connect.** Open the site. Click **Make a multi-booth poll**. The first time, the site asks for the voting-centre address and the organiser code. The site saves them in your browser.
3. **Make the poll.** Enter the question, the choices, how many choices a voter can rank, and a booth password. Choose how long a booth may stay open (the default is 2 hours).
4. **Share.** Send the booth link to one *booth host* in each group, for example a teacher or a team leader. Send the booth password in a separate message.
5. **Open a booth.** Each booth host opens the link on a phone, a tablet or a computer. The host enters a group name and the password. The host chooses how the group votes:
   - 🗳️ Each voter ranks the choices on the device.
   - ✋ The host counts hands and enters one total for each choice.
6. **Vote.** A booth with no signal saves its votes on the device. It sends them when the signal returns. The booth says clearly when votes have not yet reached the voting centre.
7. **Finish.** Each host presses **Finish voting here** (with the booth password). The booth shows its own result. Later it also shows the overall result, when you share it.
8. **Close.** On the admin page, press **Close voting**. The booths stop taking new votes. A ballot that was cast before the close still counts when it arrives later. The admin page shows how many ballots each booth cast and how many arrived.
9. **Finalise.** When every booth shows "All received", press **Finalise results**. Tick the box to share the overall result on the booths and on a public link.

The home page lists the polls that you made in this browser, with their state (open, closed or final). Click one to return to its admin page.

## What it can do

- **Pictures are optional.** A choice can have a photo, or only a name.
- **Round-by-round results** with a bar for each choice, so the count is easy to follow.
- **Offline voting.** Booths keep working with a weak signal, and the page shows plainly when votes are only on the device.
- **Close and finalise.** Late booths do not lose votes that were cast in time.
- **Show of hands.** A group that cannot vote on a device can count hands. You choose whether the app counts only the first choice, or also estimates the later choices from the ranked ballots of the other groups. The result page says when it used an estimate.
- **Count method.** Every ballot is one vote, or every group is one vote.
- **Groups with no device.** You can enter hand-count totals for a group yourself.
- **Booth time window.** A booth can start later (within 24 hours) and close itself after a set time.
- **CSV download** of the ranked ballots.

## Privacy

- A ballot holds the ranking, the group name and a random ID of the booth device. It holds no voter name and no time of day.
- The server does not keep the cast time of a ballot. It uses the time once, to decide whether the ballot came before the poll closed.
- The admin page cannot see any ballot until voting closes.
- The admin key and the booth password are stored on the server only as hashes.
- The app has no tracking and no accounts. The pages load two fonts from Google Fonts. You can remove the font links in the HTML pages.

Anyone who has the booth link and the password can cast ballots. The app does not stop one person from voting twice. The booth host watches the booth, as at a real polling station.

## Limits

- Counts are instant-runoff. Other methods (Borda, Condorcet) are not offered.
- A booth needs a signal when the host first opens it, and to send votes. It can run with no signal in between.
- A booth result on a device can differ from the overall result. This is normal.
- Instant runoff settles a tie for last place by looking at earlier rounds. If all earlier rounds are equal, the last choice in the poll list is out. [DEVELOPING.md](DEVELOPING.md) has the exact rule.

## More

- [How ranked-choice voting works](ranked-choice-voting.html): a short guide with an example, for voters and teachers.
- [INSTALLING.md](INSTALLING.md): set up your own voting centre on Cloudflare, step by step.
- [DEVELOPING.md](DEVELOPING.md): how the code works, how to run the tests, and how to contribute.

## Licence

Quick Vote is open source under the [MIT licence](LICENSE).
