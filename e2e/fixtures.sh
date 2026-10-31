#!/usr/bin/env bash
# Generates the test videos used by e2e/suite.mjs. Needs ffmpeg.
# Most videos flash white and beep at every whole second, so A/V sync can be measured.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .fixtures && cd .fixtures
A="aevalsrc='if(lt(mod(t\,1)\,0.1)\,0.8*sin(2*PI*1000*t)\,0.4*(0.1+0.9*abs(sin(t/1.3)))*sin(2*PI*220*t))':s=48000"
FL="drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t\,1)\,0.1)'"
q() { ffmpeg -v error -y "$@"; }
q -f lavfi -i "testsrc2=size=1920x1080:rate=30000/1001:duration=30" -f lavfi -i "$A:d=30" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 192k -shortest test30.mp4
q -f lavfi -i "testsrc2=size=1920x1080:rate=30000/1001:duration=60" -f lavfi -i "$A:d=60" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 192k -shortest test60.mp4
q -f lavfi -i "testsrc2=size=1920x1080:rate=30000/1001:duration=20" -f lavfi -i "$A:d=20" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -shortest clip.mov
q -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=15" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast noaudio.mp4
q -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=15" -f lavfi -i "$A:d=15" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -shortest fps60.mp4
q -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=10" -f lavfi -i "$A:d=10" -vf "$FL" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -shortest rot0.mp4
q -display_rotation 90 -i rot0.mp4 -c copy rotated.mp4 && rm rot0.mp4
q -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=10" -f lavfi -i "$A:d=10" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -shortest portrait.mp4
q -f lavfi -i "testsrc2=size=1920x1080:rate=25:duration=10" -f lavfi -i "$A:d=10" -vf "scale=out_color_matrix=bt709:out_range=tv" -c:v libx264 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -preset veryfast -c:a aac -shortest bt709.mp4
q -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" -f lavfi -i "sine=f=440:d=12" -c:v libvpx-vp9 -b:v 1M -c:a libopus vp9.webm
q -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=150" -f lavfi -i "$A:d=150" -c:v libx264 -preset ultrafast -crf 35 -c:a aac -b:a 64k -shortest long150.mp4
q -f lavfi -i "mandelbrot=size=640x360:rate=30" -t 4 -c:v libx264 -pix_fmt yuv420p bgloop.mp4
q -f lavfi -i "gradients=s=1920x1080:c0=0x223355:c1=0x885522:n=3,format=yuv420p" -frames:v 1 bg.jpg
q -filter_complex "color=c=black@0.0:s=400x80,format=rgba[bg];color=c=0x00FFAA:s=80x80,format=rgba[a];color=c=white:s=280x40,format=rgba[b];[bg][a]overlay=0:0[t];[t][b]overlay=100:20" -frames:v 1 logo.png
cat > logo.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60" viewBox="0 0 300 60"><path d="M30 0 60 60H0z" fill="#0f0"/><rect x="75" y="10" width="220" height="40" fill="#0f0"/></svg>
SVG
echo '{"not":"a project"}' > bad.json
echo hello > notvideo.txt
echo "fixtures ready in $(pwd)"
# Templates: storyboard frames, a BTS recording in sync with test30, and a music file.
cd "$(dirname "$0")/.fixtures"
i=1; for c in 0xE63946 0x2A9D8F 0xE9C46A 0x264653 0x8E44AD; do
  q -f lavfi -i "color=c=$c:s=1600x900" -vf "drawbox=x=100:y=100:w=1400:h=700:color=white@0.6:t=8" -frames:v 1 sb$i.png; i=$((i+1)); done
q -f lavfi -i "testsrc2=size=1920x1080:rate=30000/1001:duration=30" -vf "drawgrid=w=240:h=240:t=3:c=0x00FF88@0.9,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t\,1)\,0.1)'" -c:v libx264 -pix_fmt yuv420p -preset veryfast bts30.mp4
q -f lavfi -i "sine=f=330:d=20" -c:a aac -b:a 128k music.m4a
# Any TTF works as the "brand font" for the text tests.
cp "$(fc-list : file | grep -m1 -i '\.ttf' | cut -d: -f1)" brand.ttf
# Showreel: 12 short clips, each a different solid color with a moving marker.
i=1; for c in 0xFF0000 0x00FF00 0x0000FF 0xFFFF00 0xFF00FF 0x00FFFF 0xFF8000 0x8000FF 0x00FF80 0xFF0080 0x80FF00 0x0080FF; do
  q -f lavfi -i "color=c=$c:s=1280x720:r=30:d=4" -f lavfi -i "sine=f=$((200+i*40)):d=4" -vf "drawbox=x='mod(t*300\,1180)':y=600:w=100:h=100:color=black:t=fill" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -shortest reel$(printf %02d $i).mp4; i=$((i+1)); done
# Music with a low bed and beeps at exactly 5s and 8s (to check "start the track at").
q -f lavfi -i "aevalsrc='if(between(t\,5\,5.1)+between(t\,8\,8.1)\,0.8*sin(2*PI*1000*t)\,0.3*sin(2*PI*220*t))':s=48000:d=20" -c:a aac -b:a 160k beeps.m4a
