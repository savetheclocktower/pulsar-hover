# pulsar-hover

Contextual hints for Pulsar.

Designed as a replacement for `atom-ide-datatip`.

## Services

This package can show most datatips from [packages that consume Atom IDE’s `datatip` service](https://web.pulsar-edit.dev/packages?serviceType=consumed&service=datatip), but it purposefully drops support for some of that service’s arcane features. You probably won’t miss them. All the stuff provided by most IDE packages is supported.

Because the `datatip` service is a bit bloated and (strangely) inverts the consumer/provider relationship, this package prefers a new service called `hover`. When searching for a provider for a particular editor pane, [`hover` providers](https://web.pulsar-edit.dev/packages?serviceType=provided&service=hover) will be given priority over `datatip` consumers. (This service may not yet have _any_ providers at time of release, but some will emerge after this service is added to `@savetheclocktower/atom-languageclient`).

## Commands

|Command|Description|Keybinding (Linux/Windows)|Keybinding (macOS)|
|-------|-----------|------------------|-----------------|
|`pulsar-hover:toggle`|Toggle overlay visibility at cursor|<kbd>ctrl-alt-h</kbd>|<kbd>cmd-opt-h</kbd>|

## Configuration

### `pulsar-hover.showOverlayOnCursorMove`

Whether to show the overlay automatically when the cursor moves to a new location. Defaults to `false`, meaning you must invoke the `pulsar-hover:toggle` command to hide/show the overlay at the cursor position.

### `pulsar-hover.showOverlayOnMouseMove`

Whether to show the overlay automatically when the mouse pointer moves to a new location within the active editor. Defaults to `true`. When disabled, mouse activity will not trigger the showing of hover overlays.

### `pulsar-hover.hoverTime`

How long (in milliseconds) to wait before asking for hover information on mouse or cursor rest; also how long for the hover overlay to linger on screen after mouse or cursor movement. Defaults to `250`.
