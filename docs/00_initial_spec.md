# Capture
Capture is a tool for capturing anything as soon as you think of it, through multiple input channels. Thoughts, ideas, notes, anything that is worthy of remembering is captured. This specification document will focus on a simple responsive webui and mcp connections, but future specifications will build upon this. The webui will capture inputs and display them, mcp support will allow agents to bypass the webui, add, edit and list captures.

## Objectives
* Provide a clean webui for capturing inputs through a single multiline text interface
* Provide a clean webui for displaying captured inputs
* Integrated with a LLM to automatically tag captures
* Provide MCP connectors to allow agents to interact with captures
* Store captures in a local sqlite database
* Provide functionality to edit, delete, manually re-tag captures

## Configuration
This app will have a single `settings.yaml` file located in the root of the project and will contain all the configuration settings. Use a nested structure where necessary to logically separate blocks of configuration.

## Data layer
Captures will be stored in a local sqlite database to avoid the complexities of managing a 3rd party database. Initially, the user will be inputting captures using text only. However, the edge capture might be a voice note or an image. In these examples the LLM integration would transcribe the voice note to text, or read the text from an image. So what is being stored will always be text-based.

Alongside the capture itself there will be additional meta information such as date and time, tags. This isn't an exhaustive list but the most obvious meta information, so add anything else you feel necessary. The meta information is there to capture context and make interpreting the capture more intuative later on. The LLM integration will complete some of this meta information, such as tags.

A capture can be archived and deleted. Archived means just changing its state, which affects whether it's shown in the archive section or not on the webui.

## LLM integration
To make capture more useful and lower the effort required for the capture, a LLM will be used to provide context for the capture. The key thing here is that the capture infers the context. If I added the following capture "I have an idea on how to eliminate terms and conditions breaches, by giving users the ability to summarise any terms and conditions document to highlight the key risks to them", this is clearly an idea which I want to explore in the future. Therefore, the LLM should suggest a tag such as "idea".

Within the configuration file use the following, but adjust if necessary:

```
llm:
  enabled: yes
  url: http://localhost:8080/v1
  model: qwen3.8-27b
```

The `enabled` setting can be either `yes` or `no`. When this is set to `no`, this prevents auto-tagging. This means a capture automatically gets tagged as `inbox`.

## MCP support
This app should provide MCP support so it's functions can be easily accessed from other agents. The following functions should be made available via MCP:
* list all captures
* search captures (by capture content and/or tags)
* add a capture
* edit a capture (change the content, tags)
* archive a capture (simply changing its state)
* delete a capture (actually remove it from the database)

## WebUI
This should be a clean interface initially showing all captures organised by tag. It is crutial that the interface does not overwhelm the user when there is a lot of active captures, so think about the user inferface and experience. Use colours which lends themselves well for this type of application, with the primary objectives of productivity and focus. Perhaps offer different ways of viewing the captures, to cater for more visual users and more data-driven users. 

When capturing provide a keyboard shortcut and an actual button to press. The capture interface should overlay on top of the main interface, blurring the background to provide focus, this needs to work well on desktop and mobile devices. Provide plenty of room for the user to input their capture, with this being a multiline text field allow the enter key to add a new line rather than automatically submitting the capture. Then the user can either click a button to save the capture or a keyboard shortcut to perform the same action (Cmd/Ctrl + Enter would be good). Editing an existing capture should re-use the same overlay interface, but adjust the context so the user knows they're editing. 

When a new capture takes place the LLM should be called to automatically tag the capture based solely on the capture itself. In the configuration there should be a list of supported tags, initially these should be: `inbox`, `todo`, `idea`, `urgent`. The app should read the configuration file, rather than hold these tags in memory. This feature can be turned off, which bypasses the LLM completely. `inbox` should only be used by the LLM when a tag cannot be determined from the user's capture text.

Deleting a capture should present a warning, prompting for confirmation as this is a destructive action.

Archiving a cpature should be instant without confirmation, but provide a toast message giving the user a few seconds to undo that change.

## Development notes
This will be an open source project, hosted on GitHub to the public. Ensure the repository is properly setup with a MIT license, contain the correct files, etc. that typically go with an open source project.

This will be a python backend application, use whatever frontend framework (if any) to implement this.

Please write a detailed `README.md` file, with everything an user would need to know about this project, how to run it, etc.
