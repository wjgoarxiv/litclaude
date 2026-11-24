"""Drive an installer at a real terminal, key by key.

stdin: {"size": [cols, rows], "steps": [[wait-for text, keys, seconds to wait after], ...]}. Text is matched
in what arrived since the last step. Prints the bytes, the exit status, whether the terminal was back in
cooked mode with echo, and whether every step ran.
"""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

plan = json.load(sys.stdin)
master, slave = pty.openpty()
cols, rows = plan["size"]
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
output = bytearray()
mark = 0
step = 0
timed_out = False
deadline = time.monotonic() + 40
try:
    while True:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                output.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
        elif child.poll() is not None:
            break
        if step < len(plan["steps"]) and plan["steps"][step][0].encode() in output[mark:]:
            _, keys, pause = plan["steps"][step]
            mark = len(output)
            step += 1
            os.write(master, keys.encode())
            time.sleep(pause)
    cooked = bool(termios.tcgetattr(slave)[3] & termios.ICANON and termios.tcgetattr(slave)[3] & termios.ECHO)
finally:
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    os.close(slave)
    os.close(master)

print(json.dumps({"exit": child.returncode, "output": output.decode("utf-8", errors="replace"),
                  "steps": step, "timedOut": timed_out, "cooked": cooked}))
