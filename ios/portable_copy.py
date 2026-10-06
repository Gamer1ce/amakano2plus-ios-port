"""Independent APFS clones for staging, with portable copy2 fallback."""
import ctypes
import errno
import os
import shutil
import stat
import sys


def _load_clonefile():
    if sys.platform != "darwin":
        return None
    try:
        function = ctypes.CDLL(None, use_errno=True).clonefile
    except (OSError, AttributeError):
        return None
    function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
    function.restype = ctypes.c_int
    return function


_CLONEFILE = _load_clonefile()
_FALLBACK_ERRORS = {errno.EXDEV, errno.ENOTSUP, errno.EOPNOTSUPP, errno.ENOSYS}
_CLONE_NOOWNERCOPY = 0x0002  # copy2 preserves attributes, but does not copy owner.


def _record(stats, method, destination):
    if stats is not None:
        stats[method + "Files"] = stats.get(method + "Files", 0) + 1
        stats[method + "Bytes"] = stats.get(method + "Bytes", 0) + os.stat(destination, follow_symlinks=False).st_size


def copy_file(source, destination, *, follow_symlinks=True, stats=None):
    """Match copy2 semantics; clone only regular files to fresh destinations.

    clonefile creates an independent inode with copy-on-write data. No hard link
    is created. Existing destinations and symlinks use ordinary copy2; an
    unexpected clone failure propagates rather than hiding permission/I/O errors.
    """
    source = os.fspath(source)
    destination = os.fspath(destination)
    if os.path.isdir(destination):
        destination = os.path.join(destination, os.path.basename(source))
    regular = stat.S_ISREG(os.stat(source, follow_symlinks=False).st_mode)
    if _CLONEFILE is None or not regular or os.path.lexists(destination):
        result = shutil.copy2(source, destination, follow_symlinks=follow_symlinks)
        _record(stats, "copied", result)
        return result
    ctypes.set_errno(0)
    if _CLONEFILE(os.fsencode(source), os.fsencode(destination), _CLONE_NOOWNERCOPY) == 0:
        # Restore copy2's mode, timestamps and flags after the atomic clone.
        shutil.copystat(source, destination, follow_symlinks=follow_symlinks)
        _record(stats, "cloned", destination)
        return destination
    error = ctypes.get_errno()
    if error not in _FALLBACK_ERRORS:
        raise OSError(error, os.strerror(error), source, None, destination)
    result = shutil.copy2(source, destination, follow_symlinks=follow_symlinks)
    _record(stats, "copied", result)
    return result
