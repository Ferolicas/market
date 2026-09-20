"""Inspect and losslessly deduplicate standalone Godot 4.7.2 PCK files.

Only identical file bodies share an offset; all paths, MD5s and resource bytes
remain unchanged. Format authority: Godot 4.7.2 core/io/file_access_pack.cpp.
Encrypted, embedded and other pack versions are deliberately rejected.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import struct
import tempfile


def index_pack(path):
    with path.open('rb') as source:
        header = source.read(112)
        if len(header) != 112 or header[:4] != b'GDPC':
            raise ValueError('Expected a standalone PCK')
        if struct.unpack_from('<5I', header, 4) != (4, 4, 7, 2, 2):
            raise ValueError('Expected unencrypted Godot 4.7.2 PCK v4')
        base, directory = struct.unpack_from('<QQ', header, 24)
        if base != len(header) or not base <= directory < path.stat().st_size:
            raise ValueError('Invalid file base/directory')
        source.seek(directory)
        count, = struct.unpack('<I', source.read(4))
        entries = []
        names = set()
        for _ in range(count):
            length, = struct.unpack('<I', source.read(4))
            if length > 65536:
                raise ValueError('Invalid path length')
            encoded = source.read(length)
            name = encoded.rstrip(b'\0').decode('utf8')
            offset, size = struct.unpack('<QQ', source.read(16))
            md5 = source.read(16)
            flags, = struct.unpack('<I', source.read(4))
            if flags or name in names or base + offset + size > directory:
                raise ValueError(f'Unsupported/invalid entry {name}')
            names.add(name)
            entries.append(dict(name=name, encoded=encoded, offset=offset, size=size, md5=md5))
        for entry in entries:
            source.seek(base + entry['offset'])
            body = source.read(entry['size'])
            if hashlib.md5(body).digest() != entry['md5']:
                raise ValueError(f'PCK checksum mismatch: {entry["name"]}')
            entry['sha256'] = hashlib.sha256(body).hexdigest()
    return header, entries


def summary(path, entries):
    groups = defaultdict(list)
    types = defaultdict(lambda: dict(files=0, logicalBytes=0))
    for entry in entries:
        groups[entry['sha256']].append(entry)
        kind = types[Path(entry['name']).suffix]
        kind['files'] += 1
        kind['logicalBytes'] += entry['size']
    duplicates = [group for group in groups.values() if len(group) > 1]
    # After optimization aliases still exist, but share physical payloads.
    redundant = sum((len({entry['offset'] for entry in group}) - 1) * group[0]['size'] for group in duplicates)
    return dict(bytes=path.stat().st_size, files=len(entries), redundantBytes=redundant,
                types=dict(types), duplicates=[[entry['name'] for entry in group] for group in duplicates],
                largest=[dict(name=e['name'], bytes=e['size']) for e in sorted(entries, key=lambda e: e['size'], reverse=True)[:20]])


def deduplicate(path, destination):
    header, entries = index_pack(path)
    original_size = path.stat().st_size
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.pck-', delete=False) as output, path.open('rb') as source:
            temp = Path(output.name)
            output.write(header)
            offsets = {}
            rewritten = []
            for entry in entries:
                fingerprint = entry['sha256']
                if fingerprint not in offsets:
                    output.write(b'\0' * (-output.tell() % 16))
                    offsets[fingerprint] = output.tell() - len(header)
                    source.seek(len(header) + entry['offset'])
                    output.write(source.read(entry['size']))
                rewritten.append((entry, offsets[fingerprint]))
            output.write(b'\0' * (-output.tell() % 16))
            directory = output.tell()
            output.write(struct.pack('<I', len(entries)))
            for entry, offset in rewritten:
                output.write(struct.pack('<I', len(entry['encoded'])))
                output.write(entry['encoded'])
                output.write(struct.pack('<QQ', offset, entry['size']))
                output.write(entry['md5'])
                output.write(struct.pack('<I', 0))
            output.write(b'\0' * (-output.tell() % 16))
            output.seek(32)
            output.write(struct.pack('<Q', directory))
        _, checked = index_pack(temp)
        identity = lambda items: [(e['name'], e['size'], e['sha256']) for e in items]
        if identity(entries) != identity(checked):
            raise ValueError('Resource identities changed during deduplication')
        temp.chmod(path.stat().st_mode & 0o777)
        temp.replace(destination)
        print(f'PCK: {len(entries)} paths verified byte-for-byte; {original_size} → {destination.stat().st_size} bytes')
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', type=Path)
    parser.add_argument('--deduplicate', type=Path, metavar='OUTPUT')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.deduplicate:
        deduplicate(args.pack, args.deduplicate)
        args.pack = args.deduplicate
    _, contents = index_pack(args.pack)
    report = json.dumps(summary(args.pack, contents), indent=2) + '\n'
    if args.report:
        args.report.write_text(report)
    elif not args.deduplicate:
        print(report)
