"""Lift a wall module's front off the sheet, square on, and read its bands.

The front is a clean quadrilateral: cream, a green stripe, a dark base, under a
dark cap. Its four edges are found as lines -- the right edge and the base
against the ground from the object's hull, the top under the cap and the left
crease against the side face from luminance steps along scanlines -- and their
crossings map to the unit square. The bands are then read straight down the
rectified front as fractions of its height, with each band's median colour.
"""
import sys, math
import numpy as np
from PIL import Image
sheet, x0, y0, x1, y1, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
img = Image.open(sheet).convert("RGB"); crop = np.asarray(img.crop((x0,y0,x1,y1))).astype(float); H, W = crop.shape[:2]
lum = crop.mean(2); ground = np.median(np.concatenate([crop[0], crop[-1], crop[:,0]]), 0)
obj = np.abs(crop - ground).sum(2) > 30
def close(m,k):
    o=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1): o|=np.roll(np.roll(m,dy,0),dx,1)
    o2=o.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1): o2&=np.roll(np.roll(o,dy,0),dx,1)
    return o2
obj = close(obj, 2)
ys, xs = np.nonzero(obj)
# hull edges
P = np.stack([xs, ys], 1).astype(float); P = P[np.lexsort((P[:,1],P[:,0]))]
def half(pts):
    h=[]
    for p in pts:
        while len(h)>=2 and ((h[-1]-h[-2])[0]*(p-h[-2])[1]-(h[-1]-h[-2])[1]*(p-h[-2])[0])<=1e-12: h.pop()
        h.append(p)
    return h
hull = np.array(half(P)[:-1] + half(P[::-1])[:-1])
def fit(pts):
    c=pts.mean(0); _,_,vt=np.linalg.svd(pts-c); d=vt[0]; n=np.array([-d[1],d[0]]); n/=np.linalg.norm(n); return n, float(n@c)
# split hull into straight runs
dirs=np.degrees(np.arctan2(*(np.roll(hull,-1,0)-hull)[:,::-1].T)); runs=[]; st=0
def ad(a,b): return abs((a-b+180)%360-180)
for i in range(1,len(hull)+1):
    if i==len(hull) or ad(dirs[i%len(hull)],dirs[st])>20: runs.append(list(range(st,i))); st=i
runs=sorted(runs,key=lambda r:-sum(np.linalg.norm(hull[(k+1)%len(hull)]-hull[k]) for k in r))[:6]
edges=[fit(np.array([hull[k] for k in r]+[hull[(r[-1]+1)%len(hull)]])) for r in runs]
# classify: right edge = vertical-ish line with largest x ; bottom = the diagonal at largest y whose normal points down
vert=[(n,r) for n,r in edges if abs(n[0])>0.9]; diag=[(n,r) for n,r in edges if abs(n[0])<=0.9]
right=max(vert,key=lambda e:(e[1]/e[0][0]) if e[0][0]!=0 else -1e9)       # line x = r/n0 ... larger x
left_hull=min(vert,key=lambda e:(e[1]/e[0][0]) if e[0][0]!=0 else 1e9)
# bottom edge: diagonal line with the largest mean y along the object width
def mean_y(n,r):
    xsamp=np.linspace(xs.min(),xs.max(),20); return np.mean([(r-n[0]*x)/n[1] for x in xsamp if abs(n[1])>1e-6])
bottom=max(diag,key=lambda e:mean_y(*e))
# top of front = cream->dark cap step, per column, in the upper part; left crease = side->front step per row
cream=(crop[:,:,0]>190)&(crop[:,:,1]>175)&(crop[:,:,2]>140)&(crop[:,:,0]-crop[:,:,2]>25)
top_pts=[]
for x in range(int(xs.min()+ (xs.max()-xs.min())*0.15), int(xs.max()- (xs.max()-xs.min())*0.05)):
    col=np.nonzero(cream[:,x])[0]
    if len(col)>10: top_pts.append((x, col.min()))          # first cream pixel from the top = under the cap
top_pts=np.array(top_pts,float); topline=fit(top_pts)
left_pts=[]
for y in range(int(ys.min()+(ys.max()-ys.min())*0.15), int(ys.max()-(ys.max()-ys.min())*0.35)):
    row=np.nonzero(cream[y,:])[0]
    if len(row)>10: left_pts.append((row.min(), y))         # first cream pixel from the left = the crease
left_pts=np.array(left_pts,float); leftline=fit(left_pts)
def inter(a,b):
    (n1,r1),(n2,r2)=a,b; return np.linalg.solve(np.array([n1,n2]),np.array([r1,r2]))
TL=inter(topline,leftline); TR=inter(topline,right); BR=inter(bottom,right); BL=inter(bottom,leftline)
print(f"esquinas del frente (px del recorte): TL {TL.round(1)} TR {TR.round(1)} BR {BR.round(1)} BL {BL.round(1)}")
src=np.array([TL,TR,BR,BL]); dst=np.array([[0,0],[1,0],[1,1],[0,1]],float)
A=[]
for (x,y),(u,v) in zip(src,dst):
    A.append([-x,-y,-1,0,0,0,u*x,u*y,u]); A.append([0,0,0,-x,-y,-1,v*x,v*y,v])
_,_,vt=np.linalg.svd(np.array(A)); Hm=vt[-1].reshape(3,3); Hi=np.linalg.inv(Hm)
size=512
uu,vv=np.meshgrid((np.arange(size)+.5)/size,(np.arange(size)+.5)/size)
q=np.stack([uu.ravel(),vv.ravel(),np.ones(size*size)],1)@Hi.T; p=q[:,:2]/q[:,2:3]
full=np.asarray(img).astype(np.uint8)
xi=np.clip(np.round(p[:,0]+x0).astype(int),0,full.shape[1]-1); yi=np.clip(np.round(p[:,1]+y0).astype(int),0,full.shape[0]-1)
rect=full[yi,xi].reshape(size,size,3); Image.fromarray(rect).save(out)
# bands down the rectified front (middle 60% of width), from the top
col=rect[:, int(size*.2):int(size*.8)].astype(float).mean(1)      # (size,3) per row
lumr=col.mean(1); bands=[]; st=0
for i in range(1,size):
    if np.abs(col[i]-col[st]).sum()>60 and i-st>size*0.02:
        bands.append((st/size,i/size,col[st:i].mean(0))); st=i
bands.append((st/size,1.0,col[st:].mean(0)))
print("bandas del frente, de arriba a abajo (fraccion de la altura, color medio):")
for a,b,c in bands: print(f"   {a:.3f}-{b:.3f}  #{int(c[0]):02X}{int(c[1]):02X}{int(c[2]):02X}")
