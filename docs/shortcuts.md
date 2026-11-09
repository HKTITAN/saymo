# Shortcuts and Raycast

Start a film from anywhere with a link, or run the studio's commands from Raycast. The studio must be running (`npm run dev`).

## Start a film from a link

```text
http://localhost:3200/studio?new=A%206%20second%20loop%20of%20orange%20lines&format=9:16
```

| Parameter | Required | Meaning |
| --- | --- | --- |
| `new` | Yes | The prompt, URL-encoded. |
| `format` | No | `16:9` (the default), `1:1`, `4:5` or `9:16`. |

The studio opens with the new film card showing that prompt and size. Nothing starts until you check the prompt and send it, so a link on its own can't make a film.

To open a film you already have: `http://localhost:3200/studio?film=<id>`.

## Raycast: a Quicklink

1. In Raycast, run **Create Quicklink**.
2. Name: `New studio film`.
3. Link: `http://localhost:3200/studio?new={Query}&format=16:9`
4. Save. Type `New studio film`, then the prompt, and press Enter.

Raycast encodes what you type. Make one Quicklink per format you use, such as `New story film` with `format=9:16`.

## Raycast: a Script Command

For things a link can't do, such as listing films or rendering one, use a Script Command that calls the command line.

1. In Raycast, run **Create Script Command**. Pick **Bash**, mode **Full Output**, and a folder for your scripts.
2. Replace the file's contents with the script below, and set `STUDIO` to the studio's folder.

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Render studio film
# @raycast.mode fullOutput
# @raycast.packageName Saymo
# @raycast.argument1 { "type": "text", "placeholder": "film id" }
# @raycast.argument2 { "type": "dropdown", "placeholder": "quality", "data": [{"title": "Draft", "value": "--draft"}, {"title": "Final", "value": ""}] }

STUDIO="$HOME/Desktop/projects/saymo"
cd "$STUDIO" || exit 1
node scripts/studio/cli.mjs render "$1" $2
```

Raycast doesn't load your Terminal's set-up, so if `node` isn't found, put its full path in place of `node`. The studio shows it under **Use the studio from other apps**.

The same pattern works for the other commands, for example `node scripts/studio/cli.mjs films` in a script titled `Studio films`, or `new "$1" --format 9:16` to make a film straight away.

## Shortcuts

1. Make a shortcut with **Ask for Input** (Text, "What should the film be?").
2. Add **URL Encode** with **Provided Input**.
3. Add **Text**: `http://localhost:3200/studio?new=` followed by the **URL Encoded Text** variable, then `&format=9:16` if you want a story.
4. Add **Open URLs** with that text.

To run a command instead, use **Run Shell Script** with `cd ~/Desktop/projects/saymo && node scripts/studio/cli.mjs films`.
