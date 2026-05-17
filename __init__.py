# __init__.py
from .nodes import KinrolBatchLoadImages

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "KinrolBatchLoadImages": KinrolBatchLoadImages,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KinrolBatchLoadImages": "Kinrol Batch Load Images",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]