"""One panel, joint centre to joint centre, so the tile repeats without a seam.

Painting each tile with its whole face carries the slab's outer rim onto every
tile edge, and that rim is what shows as a line at each block of nine. Taking
instead the panel between two joints -- half a joint on each side -- and
repeating it means every edge of every tile is half a joint meeting half a
joint: the same joint as any interior one, and no block is distinguishable.
Where an axis has a single joint, the two half-panels either side of it are
rolled so that joint lands on the edges; the panels are plain speckle, so the
roll's own seam has nothing to show.
"""
import sys
import numpy as np
from PIL import Image
src, out, nx, ny = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = np.asarray(Image.open(src).convert("RGB")); N = im.shape[0]
def axis_crop(n):
    if n >= 2:            # joints at 1/3 and 2/3 -> the middle panel
        return slice(N//3, 2*N//3), False
    return slice(N//4, 3*N//4), True     # single joint at 1/2 -> [1/4,3/4] then roll by half
sv, rv = axis_crop(ny); su, ru = axis_crop(nx)
panel = im[sv, su]
if ru: panel = np.roll(panel, panel.shape[1]//2, axis=1)
if rv: panel = np.roll(panel, panel.shape[0]//2, axis=0)
Image.fromarray(panel).save(out)
print(f"panel {panel.shape[1]}x{panel.shape[0]} -> {out}")
