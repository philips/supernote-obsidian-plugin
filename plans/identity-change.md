# Identity Change

The identity and general description of this project needs to be updated so that
this project becomes a new and completely separate fork of the original project.

## Metdata

Here are some key metadata files that should change:

Name: Supernote (Unofficial) -> Journal Companion Obsidian Plugin ID: supernote
-> journal-companion Version: v1.31.0 -> v0.1.0 Author: Brandon Philips ->
SolerSoft LLC GitHub / BRAT:
https://github.com/philips/supernote-obsidian-plugin ->
https://github.com/SolerSoft/obsidian-journal-companion

Please identify any other important values that should be changed in this step.
If you are unclear whether a value should change or what it's new value should
be, stop and ask the user for input. If you receive a note that the user is
away, stop and wait for the user to return.

## README.md

Update README.md. We should note that this project was intentionally forked from
https://github.com/philips/supernote-obsidian-plugin to take the project in a
different direction. Maintain similar formatting. Explain that it was forked to
support my partner in journaling through Obsidian with both a physical Supernote
device and eventually scanned copies of her journals growing up. Key differences
from the original project include:

1. Supernote Cloud synchronization (direct IP is still supported)
2. Sync abstraction layer that should easily allow support for more devices in
   the future.
3. Automatic synchronization on a schedule.
4. Automatic conversion of note files to markdown whenever synchronized, created
   or updated. ?.
   <<List other meaningful features you think we should include compared to the upstream project. >>

Next, include key portions of the original README.md that still apply to the
current implementation. Avoid copying parts that were personally specific to the
original author, but include key features that are still present and functional.

Finally, we need this README.md to specify that this project will evolve
primarily to support my partner in her journaling workflow. We will accept pull
requests when they align to our project goals, but we also encourage others to
fork and modify the project to suit their own needs. Mention that with AI coding
today we want to empower everyone to create software that exactly meets their
own needs.
