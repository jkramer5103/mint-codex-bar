#!/usr/bin/env python3
"""Local connection editor; secrets never enter argv or collector output."""
import json
import os
from pathlib import Path
import tempfile
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk

folder = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'mintcodexbar'
config = folder / 'connection.json'
try:
    current = json.loads(config.read_text())
except (OSError, ValueError):
    current = {}
dialog = Gtk.Dialog(title='CLIProxyAPI connection', flags=0)
dialog.add_button('Cancel', Gtk.ResponseType.CANCEL)
dialog.add_button('Save connection', Gtk.ResponseType.OK)
dialog.set_default_size(440, -1)
box = dialog.get_content_area()
box.set_border_width(20)
box.set_spacing(10)
for text in ['Connect your panel to CLIProxyAPI', 'Use the management key, not an inference API key.']:
    label = Gtk.Label(label=text, xalign=0)
    box.pack_start(label, False, False, 0)
box.pack_start(Gtk.Label(label='Server URL', xalign=0), False, False, 0)
url = Gtk.Entry()
url.set_text(current.get('url', 'http://127.0.0.1:8317'))
box.pack_start(url, False, False, 0)
box.pack_start(Gtk.Label(label='Management key', xalign=0), False, False, 0)
key = Gtk.Entry()
key.set_visibility(False)
key.set_text(current.get('managementKey', ''))
box.pack_start(key, False, False, 0)
note = Gtk.Label(label='Saved locally with owner-only permissions. Refresh after saving.', xalign=0)
note.set_line_wrap(True)
box.pack_start(note, False, False, 0)
dialog.show_all()
while dialog.run() == Gtk.ResponseType.OK:
    if not url.get_text().strip() or not key.get_text().strip():
        note.set_text('Enter a server URL and management key.')
        continue
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(dir=folder)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump({'url': url.get_text().strip(), 'managementKey': key.get_text().strip()}, stream)
        os.replace(temp, config)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    break
dialog.destroy()
