"""Renders the original Meridian Afterglow app icon (setting sun over striped water) to public/icons/*.png. Needs Pillow."""
from PIL import Image, ImageDraw
TEAL=(18,54,58); TEAL2=(29,77,83); APR=(255,195,126); HOT=(255,155,106); CORAL=(255,90,74)
S=1024
def render(scale):
    im=Image.new('RGB',(S,S),TEAL); d=ImageDraw.Draw(im)
    for y in range(S):  # sky gradient
        t=y/S; d.line([(0,y),(S,y)],fill=tuple(int(TEAL[i]*(1-t)+TEAL2[i]*t) for i in range(3)))
    cx,cy=S//2,int(S*0.47); r=int(S*0.27*scale)
    cy=int(S/2+(cy-S/2)*scale)
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=APR)
    d.ellipse([cx-r,cy-r,cx+r,cy+r],outline=HOT,width=max(2,int(S*0.012)))
    # water: stripes that cut the lower part of the sun
    hy=cy+int(r*0.18); d.rectangle([0,hy,S,S],fill=TEAL)
    y=hy; h=int(S*0.02*scale)+2; gap=int(S*0.018*scale)+2
    while y<S*0.5+S*0.34*scale:
        w=int(r*2*(0.92-0.5*(y-hy)/(S*0.34*scale)))
        if w>10: d.rectangle([cx-w//2,y,cx+w//2,y+h],fill=APR if (y-hy)%2==0 else HOT)
        y+=h+gap; h=int(h*1.12)+1; gap=int(gap*1.15)+1
    d.rectangle([0,hy-int(S*0.004),S,hy+int(S*0.008)],fill=CORAL)
    return im
render(1.0).resize((512,512),Image.LANCZOS).save('public/icons/icon-512.png')
render(1.0).resize((192,192),Image.LANCZOS).save('public/icons/icon-192.png')
render(1.0).resize((180,180),Image.LANCZOS).save('public/icons/apple-touch-icon.png')
render(0.72).resize((512,512),Image.LANCZOS).save('public/icons/maskable-512.png')
render(0.72).resize((192,192),Image.LANCZOS).save('public/icons/maskable-192.png')
