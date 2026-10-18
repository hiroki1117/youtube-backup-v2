from mangum import Mangum

from api.factory import build_app
from api.routes import video_router

handler = Mangum(build_app(video_router), lifespan="off")
