from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.web import templates


router = APIRouter(tags=["pages"])


@router.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/assemble", status_code=303)


@router.get("/assemble", response_class=HTMLResponse)
def assemble_page(request: Request):
    return templates.TemplateResponse("assemble.html", {"request": request})


@router.get("/edit", response_class=HTMLResponse)
def edit_page(request: Request):
    return templates.TemplateResponse("edit.html", {"request": request})
