import sys
import os
import cv2
import numpy as np
from pathlib import Path

def compare_frames(frame1, frame2):
    """Compare two frames and return similarity score."""
    diff = cv2.absdiff(frame1, frame2)
    return 1 - np.mean(diff) / 255

def find_loop_points(frames_dir, min_length=30, max_length=90, threshold=0.98):
    """Find the best loop points in a sequence of frames."""
    frames = []
    frame_files = sorted(Path(frames_dir).glob('frame_*.jpg'))
    
    # Load all frames
    for f in frame_files:
        frame = cv2.imread(str(f))
        if frame is None:
            continue
        frames.append(frame)
    
    if not frames:
        return None, None
    
    best_score = 0
    best_start = 0
    best_end = 0
    
    # Compare frames to find loop points
    for start in range(len(frames) - max_length):
        start_frame = frames[start]
        
        # Look for matching frame within valid range
        for end in range(start + min_length, min(start + max_length, len(frames))):
            end_frame = frames[end]
            score = compare_frames(start_frame, end_frame)
            
            if score > best_score and score >= threshold:
                best_score = score
                best_start = start
                best_end = end
    
    if best_score == 0:
        return None, None
    
    # Convert frame numbers to seconds (assuming 30fps)
    start_time = best_start / 30
    end_time = best_end / 30
    
    return start_time, end_time

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Usage: find_loop.py frames_dir min_length max_length threshold")
        sys.exit(1)
    
    frames_dir = sys.argv[1]
    min_length = int(float(sys.argv[2]) * 30)  # Convert seconds to frames
    max_length = int(float(sys.argv[3]) * 30)  # Convert seconds to frames
    threshold = float(sys.argv[4])
    
    start_time, end_time = find_loop_points(frames_dir, min_length, max_length, threshold)
    
    if start_time is not None:
        print(f"{start_time:.3f} {end_time:.3f}")
    sys.exit(0) 